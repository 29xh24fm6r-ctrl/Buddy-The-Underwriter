/**
 * buddy-core-worker — Always-on Cloud Run service.
 *
 * Two concurrent loops:
 *   1. Heartbeat: POST mcp_tick to Pulse every 15 s (exponential backoff on failure).
 *   2. Outbox forwarder: claim undelivered rows from buddy_outbox_events,
 *      forward to Pulse via buddy_event_ingest, mark delivered or bump attempts.
 *
 * Env vars (required):
 *   BUDDY_DB_URL          — Postgres connection string (Supabase pooler)
 *   PULSE_MCP_URL         — Base URL of Pulse MCP service (no /sse suffix)
 *   PULSE_MCP_KEY         — API key header value
 *
 * Env vars (optional):
 *   BUDDY_DB_SERVICE_KEY  — Plumbed for future use (not required for pg)
 *   WORKER_ENABLED        — Master kill-switch (default true)
 *   HEARTBEAT_INTERVAL_MS — Base heartbeat interval (default 15000)
 *   POLL_INTERVAL_MS      — Outbox poll interval (default 2000)
 *   BATCH_SIZE            — Max rows per claim (default 25)
 *   HTTP_TIMEOUT_MS       — Pulse HTTP call timeout (default 2000)
 *   CLAIM_TTL_SECONDS     — Stale claim timeout in seconds (default 120)
 *   WORKER_ID             — Unique worker instance ID (default: hostname-pid)
 */

import pg from "pg";
import http from "node:http";

const { Pool } = pg;

// ─── Config ──────────────────────────────────────────────────────────────────

const BUDDY_DB_URL = requireEnv("BUDDY_DB_URL");
const PULSE_MCP_URL = requireEnv("PULSE_MCP_URL").replace(/\/sse\/?$/, "");
const PULSE_MCP_KEY = process.env.PULSE_MCP_KEY ?? "";

// Plumbed but not required for pg connections
const _BUDDY_DB_SERVICE_KEY = process.env.BUDDY_DB_SERVICE_KEY ?? "";
void _BUDDY_DB_SERVICE_KEY; // suppress unused warning

const WORKER_ENABLED = (process.env.WORKER_ENABLED ?? "true") !== "false";
const HEARTBEAT_INTERVAL_MS = intEnv("HEARTBEAT_INTERVAL_MS", 15_000);
const POLL_INTERVAL_MS = intEnv("POLL_INTERVAL_MS", 2_000);
const BATCH_SIZE = intEnv("BATCH_SIZE", 25);
const HTTP_TIMEOUT_MS = intEnv("HTTP_TIMEOUT_MS", 2_000);
const CLAIM_TTL_SECONDS = intEnv("CLAIM_TTL_SECONDS", 120);

const BACKOFF_MAX_MS = 60_000;
const PER_ROW_BACKOFF_CAP_MS = 30_000;
const WORKER_ID =
  process.env.WORKER_ID ??
  `${process.env.HOSTNAME ?? "worker"}-${process.pid}`;

// ─── Postgres pool ───────────────────────────────────────────────────────────

const pool = new Pool({ connectionString: BUDDY_DB_URL, max: 4 });

// ─── Pulse adapter ───────────────────────────────────────────────────────────

async function pulseCall(
  tool: string,
  input: Record<string, unknown>,
): Promise<{ ok: boolean; status?: number; body?: unknown; error?: string }> {
  try {
    const res = await fetch(`${PULSE_MCP_URL}/call`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(PULSE_MCP_KEY ? { "x-pulse-mcp-key": PULSE_MCP_KEY } : {}),
      },
      body: JSON.stringify({ tool, input }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });

    if (!res.ok) {
      return { ok: false, status: res.status, error: `http_${res.status}` };
    }

    const body = await res.json();
    return { ok: true, status: res.status, body };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "unknown";
    return { ok: false, error: msg };
  }
}

// ─── Heartbeat loop ──────────────────────────────────────────────────────────

let _heartbeatConsecutiveFailures = 0;

async function heartbeatTick(): Promise<void> {
  const result = await pulseCall("mcp_tick", {
    source: "buddy",
    instance_id: WORKER_ID,
    ts: new Date().toISOString(),
  });

  if (result.ok) {
    if (_heartbeatConsecutiveFailures > 0) {
      console.log("[heartbeat] recovered after", _heartbeatConsecutiveFailures, "failures");
    }
    _heartbeatConsecutiveFailures = 0;
  } else {
    _heartbeatConsecutiveFailures += 1;
    console.warn("[heartbeat] tick failed:", result.error, {
      consecutive: _heartbeatConsecutiveFailures,
    });
  }
}

function heartbeatDelay(): number {
  if (_heartbeatConsecutiveFailures === 0) return HEARTBEAT_INTERVAL_MS;
  return Math.min(
    HEARTBEAT_INTERVAL_MS * Math.pow(2, _heartbeatConsecutiveFailures),
    BACKOFF_MAX_MS,
  );
}

async function heartbeatLoop(): Promise<never> {
  console.log("[heartbeat] started", { intervalMs: HEARTBEAT_INTERVAL_MS });
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await heartbeatTick();
    } catch (err) {
      console.error("[heartbeat] unexpected:", err);
    }
    await sleep(heartbeatDelay());
  }
}

// ─── Outbox forwarder loop ───────────────────────────────────────────────────

interface OutboxRow {
  id: string;
  kind: string;
  deal_id: string;
  bank_id: string | null;
  payload: Record<string, unknown>;
  attempts: number;
}

async function claimBatch(): Promise<OutboxRow[]> {
  // Explicit transaction: SELECT FOR UPDATE SKIP LOCKED, then UPDATE claimed_at.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query<OutboxRow>(
      `SELECT id, kind, deal_id, bank_id, payload, attempts
       FROM buddy_outbox_events
       WHERE delivered_at IS NULL
         AND (claimed_at IS NULL OR claimed_at < now() - interval '1 second' * $1)
       ORDER BY created_at ASC
       LIMIT $2
       FOR UPDATE SKIP LOCKED`,
      [CLAIM_TTL_SECONDS, BATCH_SIZE],
    );

    if (rows.length > 0) {
      const ids = rows.map((r) => r.id);
      await client.query(
        `UPDATE buddy_outbox_events
         SET claimed_at = now(), claim_owner = $1
         WHERE id = ANY($2)`,
        [WORKER_ID, ids],
      );
    }

    await client.query("COMMIT");
    return rows;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function markDelivered(id: string): Promise<void> {
  await pool.query(
    `UPDATE buddy_outbox_events
     SET delivered_at = now(), last_error = null
     WHERE id = $1`,
    [id],
  );
}

async function markFailed(id: string, error: string): Promise<void> {
  await pool.query(
    `UPDATE buddy_outbox_events
     SET attempts = attempts + 1,
         last_error = $2
     WHERE id = $1`,
    [id, error.slice(0, 500)],
  );
}

function perRowBackoff(attempts: number): number {
  // Exponential backoff with cap 30s + jitter
  const base = Math.min(1000 * Math.pow(2, attempts), PER_ROW_BACKOFF_CAP_MS);
  const jitter = Math.floor(Math.random() * 500);
  return base + jitter;
}

async function forwardEvent(row: OutboxRow): Promise<void> {
  const result = await pulseCall("buddy_event_ingest", {
    event_id: row.id,
    source: "buddy",
    kind: row.kind,
    deal_id: row.deal_id,
    bank_id: row.bank_id,
    payload: row.payload,
  });

  if (result.ok) {
    await markDelivered(row.id);
  } else {
    await markFailed(row.id, result.error ?? "unknown");
    // Per-row backoff: exponential with cap 30s
    await sleep(perRowBackoff(row.attempts));
  }
}

async function outboxTick(): Promise<number> {
  const batch = await claimBatch();
  if (batch.length === 0) return 0;

  // Process sequentially; per-row backoff on failure
  for (const row of batch) {
    try {
      await forwardEvent(row);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "unknown";
      console.error("[outbox] forward error:", row.id, msg);
      try {
        await markFailed(row.id, msg);
      } catch {
        // swallow — row stays claimed, will expire via CLAIM_TTL_SECONDS
      }
      await sleep(perRowBackoff(row.attempts));
    }
  }

  return batch.length;
}

async function outboxLoop(): Promise<never> {
  console.log("[outbox] started", {
    pollMs: POLL_INTERVAL_MS,
    batchSize: BATCH_SIZE,
    claimTtlSeconds: CLAIM_TTL_SECONDS,
  });
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const processed = await outboxTick();
      // If we processed a full batch, immediately poll again (drain mode)
      if (processed >= BATCH_SIZE) continue;
    } catch (err) {
      console.error("[outbox] unexpected:", err);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Start HTTP listener first so Cloud Run marks the revision as ready
  _httpServer = startHttpServer();

  if (!WORKER_ENABLED) {
    console.log("[buddy-core-worker] WORKER_ENABLED=false, exiting");
    process.exit(0);
  }

  console.log("[buddy-core-worker] starting", {
    workerId: WORKER_ID,
    pulseUrl: PULSE_MCP_URL,
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    pollIntervalMs: POLL_INTERVAL_MS,
    batchSize: BATCH_SIZE,
    httpTimeoutMs: HTTP_TIMEOUT_MS,
    claimTtlSeconds: CLAIM_TTL_SECONDS,
  });

  // Verify DB connectivity
  try {
    await pool.query("SELECT 1");
    console.log("[buddy-core-worker] database connected");
  } catch (err) {
    console.error("[buddy-core-worker] database connection failed:", err);
    process.exit(1);
  }

  // Run both loops concurrently — neither should ever resolve
  await Promise.race([heartbeatLoop(), outboxLoop()]);

  // If we get here, something went wrong
  console.error("[buddy-core-worker] loop exited unexpectedly");
  process.exit(1);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) {
    console.error(`[buddy-core-worker] missing required env var: ${key}`);
    process.exit(1);
  }
  return v;
}

function intEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return isNaN(n) ? fallback : n;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Cloud Run HTTP listener ─────────────────────────────────────────────────

/**
 * Cloud Run services MUST listen on PORT. Even for a worker, we expose a tiny
 * health endpoint so the revision becomes ready.
 */
function startHttpServer(): http.Server {
  const port = Number(process.env.PORT ?? "8080");

  const server = http.createServer((req, res) => {
    const raw = req.url ?? "/";
    const path = raw.split("?")[0];
    if (path === "/" || path === "/healthz") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
      return;
    }
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not_found");
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`[http] listening on :${port}`);
  });

  return server;
}

// ─── Graceful shutdown ───────────────────────────────────────────────────────

let _httpServer: http.Server | undefined;

function shutdown(signal: string): void {
  console.log(`[shutdown] ${signal} received`);
  pool.end().catch(() => {});
  if (_httpServer) {
    _httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  } else {
    process.exit(0);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ─── Boot ────────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error("[buddy-core-worker] fatal:", err);
  process.exit(1);
});
