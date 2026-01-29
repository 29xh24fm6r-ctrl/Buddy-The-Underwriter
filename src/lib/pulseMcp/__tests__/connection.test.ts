import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const EMIT_PATH = "src/lib/pulseMcp/emitPipelineEvent.ts";
const OUTBOX_PATH = "src/lib/outbox/insertOutboxEvent.ts";
const INSTRUMENTATION_PATH = "src/instrumentation.ts";
const WORKER_PATH = "services/buddy-core-worker/src/index.ts";
const MIGRATION_PATH = "supabase/migrations/20260129_buddy_outbox_events.sql";

function readSource(path: string): string {
  return fs.readFileSync(path, "utf-8");
}

// ─── Outbox insert helper ────────────────────────────────────────────────────

test("outbox: insertOutboxEvent exists", () => {
  assert.ok(fs.existsSync(OUTBOX_PATH), "insertOutboxEvent.ts must exist");
});

test("outbox: never throws (has catch)", () => {
  const source = readSource(OUTBOX_PATH);
  assert.ok(source.includes("} catch"), "insertOutboxEvent must swallow errors");
});

test("outbox: uses supabaseAdmin", () => {
  const source = readSource(OUTBOX_PATH);
  assert.ok(source.includes("supabaseAdmin"), "Must use supabaseAdmin for service role access");
});

test("outbox: inserts to buddy_outbox_events", () => {
  const source = readSource(OUTBOX_PATH);
  assert.ok(
    source.includes("buddy_outbox_events"),
    "Must insert to buddy_outbox_events table",
  );
});

test("outbox: enforces max payload size", () => {
  const source = readSource(OUTBOX_PATH);
  assert.ok(source.includes("MAX_PAYLOAD_BYTES"), "Must define MAX_PAYLOAD_BYTES");
  assert.ok(source.includes("16_384") || source.includes("16384"), "Max payload must be 16KB");
});

test("outbox: accepts kind, dealId, bankId, payload", () => {
  const source = readSource(OUTBOX_PATH);
  assert.ok(source.includes("kind:"), "Must accept kind");
  assert.ok(source.includes("dealId:") || source.includes("deal_id:"), "Must accept dealId");
  assert.ok(source.includes("bankId") || source.includes("bank_id"), "Must accept bankId");
  assert.ok(source.includes("payload:"), "Must accept payload");
});

// ─── emitPipelineEvent — outbox-only ─────────────────────────────────────────

test("emitter: emitPipelineEvent never throws", () => {
  const source = readSource(EMIT_PATH);
  assert.ok(
    source.includes("} catch {"),
    "emitPipelineEvent must swallow all errors",
  );
});

test("emitter: calls insertOutboxEvent (not Pulse directly)", () => {
  const source = readSource(EMIT_PATH);
  assert.ok(
    source.includes("insertOutboxEvent"),
    "Must call insertOutboxEvent",
  );
  assert.ok(
    !source.includes("PulseMcpClient"),
    "Must NOT import PulseMcpClient (outbox-only)",
  );
  assert.ok(
    !source.includes("client.isEnabled()"),
    "Must NOT call client.isEnabled() (outbox-only)",
  );
});

test("emitter: imports from outbox module", () => {
  const source = readSource(EMIT_PATH);
  assert.ok(
    source.includes("@/lib/outbox/insertOutboxEvent") ||
      source.includes("../outbox/insertOutboxEvent"),
    "Must import from outbox module",
  );
});

test("emitter: does not depend on Pulse env vars", () => {
  const source = readSource(EMIT_PATH);
  assert.ok(
    !source.includes("PULSE_MCP_ENABLED"),
    "Must NOT check PULSE_MCP_ENABLED (outbox always writes)",
  );
  assert.ok(
    !source.includes("PULSE_MCP_URL"),
    "Must NOT reference PULSE_MCP_URL",
  );
});

// ─── Emit pipeline event — PII safety ───────────────────────────────────────

test("emitter: uses allowlist for payload keys", () => {
  const source = readSource(EMIT_PATH);
  assert.ok(source.includes("ALLOWED_PAYLOAD_KEYS"), "Must define ALLOWED_PAYLOAD_KEYS");
  assert.ok(source.includes("filterPayload"), "Must filter payload through allowlist");
});

test("emitter: does not reference PII fields in allowlist", () => {
  const source = readSource(EMIT_PATH);
  const piiFields = ["ssn", "email", "phone", "address", "borrower_name", "ocr_text", "filename"];
  for (const f of piiFields) {
    assert.ok(
      !source.includes(`"${f}"`),
      `Allowlist must NOT include PII field: ${f}`,
    );
  }
});

test("emitter: truncates long strings", () => {
  const source = readSource(EMIT_PATH);
  assert.ok(
    source.includes("v.length > 200"),
    "Must skip strings longer than 200 chars",
  );
});

// ─── Migration ───────────────────────────────────────────────────────────────

test("migration: buddy_outbox_events table exists", () => {
  assert.ok(fs.existsSync(MIGRATION_PATH), "Migration file must exist");
});

test("migration: has required columns", () => {
  const source = readSource(MIGRATION_PATH);
  const requiredCols = [
    "kind text",
    "deal_id uuid",
    "bank_id uuid",
    "payload jsonb",
    "delivered_at timestamptz",
    "attempts int",
    "last_error text",
    "claimed_at timestamptz",
    "claim_owner text",
  ];
  for (const col of requiredCols) {
    assert.ok(source.includes(col), `Migration must define column: ${col}`);
  }
});

test("migration: has RLS enabled", () => {
  const source = readSource(MIGRATION_PATH);
  assert.ok(
    source.includes("enable row level security"),
    "Must enable RLS on outbox table",
  );
});

test("migration: has deny-all policy", () => {
  const source = readSource(MIGRATION_PATH);
  assert.ok(
    source.includes("deny_all"),
    "Must have deny_all policy (service role bypasses RLS)",
  );
});

test("migration: has ready index for worker claims", () => {
  const source = readSource(MIGRATION_PATH);
  assert.ok(
    source.includes("buddy_outbox_events_ready_idx"),
    "Must have index for efficient worker claims",
  );
});

// ─── Worker: env vars ────────────────────────────────────────────────────────

test("worker: requires BUDDY_DB_URL (not DATABASE_URL)", () => {
  const source = readSource(WORKER_PATH);
  assert.ok(
    source.includes('requireEnv("BUDDY_DB_URL")'),
    "Must require BUDDY_DB_URL",
  );
  assert.ok(
    !source.includes('requireEnv("DATABASE_URL")'),
    "Must NOT use DATABASE_URL (canonical name is BUDDY_DB_URL)",
  );
});

test("worker: requires PULSE_MCP_URL", () => {
  const source = readSource(WORKER_PATH);
  assert.ok(
    source.includes('requireEnv("PULSE_MCP_URL")'),
    "Must require PULSE_MCP_URL",
  );
});

test("worker: uses PULSE_MCP_KEY (not PULSE_MCP_API_KEY)", () => {
  const source = readSource(WORKER_PATH);
  assert.ok(
    source.includes("PULSE_MCP_KEY"),
    "Must use PULSE_MCP_KEY",
  );
  assert.ok(
    !source.includes("PULSE_MCP_API_KEY"),
    "Must NOT use PULSE_MCP_API_KEY (canonical name is PULSE_MCP_KEY)",
  );
});

test("worker: has WORKER_ENABLED kill-switch", () => {
  const source = readSource(WORKER_PATH);
  assert.ok(source.includes("WORKER_ENABLED"), "Must check WORKER_ENABLED env var");
});

test("worker: uses canonical tuning var names", () => {
  const source = readSource(WORKER_PATH);
  assert.ok(source.includes("POLL_INTERVAL_MS"), "Must use POLL_INTERVAL_MS");
  assert.ok(source.includes("BATCH_SIZE"), "Must use BATCH_SIZE");
  assert.ok(source.includes("HTTP_TIMEOUT_MS"), "Must use HTTP_TIMEOUT_MS");
  assert.ok(source.includes("CLAIM_TTL_SECONDS"), "Must use CLAIM_TTL_SECONDS");
});

test("worker: plumbs BUDDY_DB_SERVICE_KEY", () => {
  const source = readSource(WORKER_PATH);
  assert.ok(
    source.includes("BUDDY_DB_SERVICE_KEY"),
    "Must plumb BUDDY_DB_SERVICE_KEY (even if not required for pg)",
  );
});

// ─── Worker: heartbeat ───────────────────────────────────────────────────────

test("worker: heartbeat uses mcp_tick (NOT buddy_heartbeat)", () => {
  const source = readSource(WORKER_PATH);
  assert.ok(
    source.includes('"mcp_tick"'),
    "Must call mcp_tick tool for heartbeat",
  );
  assert.ok(
    !source.includes('"buddy_heartbeat"'),
    "Must NOT use buddy_heartbeat (canonical tool is mcp_tick)",
  );
});

test("worker: heartbeat sends source, instance_id, ts", () => {
  const source = readSource(WORKER_PATH);
  assert.ok(
    source.includes('source: "buddy"'),
    "Heartbeat must send source: buddy",
  );
  assert.ok(
    source.includes("instance_id:"),
    "Heartbeat must send instance_id",
  );
  assert.ok(
    source.includes("ts:"),
    "Heartbeat must send ts",
  );
});

test("worker: heartbeat has exponential backoff", () => {
  const source = readSource(WORKER_PATH);
  assert.ok(source.includes("Math.pow(2"), "Must use exponential backoff");
  assert.ok(source.includes("BACKOFF_MAX_MS"), "Must define BACKOFF_MAX_MS");
  assert.ok(source.includes("60_000") || source.includes("60000"), "Max backoff must be 60s");
});

test("worker: heartbeat resets failures on success", () => {
  const source = readSource(WORKER_PATH);
  assert.ok(
    source.includes("_heartbeatConsecutiveFailures = 0"),
    "Must reset consecutive failures on success",
  );
});

test("worker: has heartbeat loop", () => {
  const source = readSource(WORKER_PATH);
  assert.ok(source.includes("heartbeatLoop"), "Must have heartbeatLoop");
  assert.ok(source.includes("heartbeatTick"), "Must have heartbeatTick");
});

// ─── Worker: outbox forwarder ────────────────────────────────────────────────

test("worker: has outbox forwarder loop", () => {
  const source = readSource(WORKER_PATH);
  assert.ok(source.includes("outboxLoop"), "Must have outboxLoop");
  assert.ok(source.includes("outboxTick"), "Must have outboxTick");
  assert.ok(source.includes("claimBatch"), "Must have claimBatch");
});

test("worker: claim uses explicit transaction (BEGIN/COMMIT)", () => {
  const source = readSource(WORKER_PATH);
  assert.ok(source.includes('"BEGIN"'), "Must BEGIN transaction");
  assert.ok(source.includes('"COMMIT"'), "Must COMMIT transaction");
  assert.ok(source.includes('"ROLLBACK"'), "Must handle ROLLBACK on error");
});

test("worker: claims with FOR UPDATE SKIP LOCKED", () => {
  const source = readSource(WORKER_PATH);
  assert.ok(
    source.includes("FOR UPDATE SKIP LOCKED"),
    "Must use FOR UPDATE SKIP LOCKED for safe concurrency",
  );
});

test("worker: claim uses SELECT then UPDATE (spec pattern)", () => {
  const source = readSource(WORKER_PATH);
  // Spec requires: SELECT...FOR UPDATE SKIP LOCKED, then UPDATE...WHERE id = ANY($ids)
  assert.ok(
    source.includes("SELECT id, kind, deal_id, bank_id, payload, attempts"),
    "Must SELECT outbox fields",
  );
  assert.ok(
    source.includes("WHERE id = ANY("),
    "Must UPDATE claimed rows by id array",
  );
});

test("worker: forwards to Pulse via buddy_event_ingest with event_id", () => {
  const source = readSource(WORKER_PATH);
  assert.ok(source.includes("buddy_event_ingest"), "Must forward as buddy_event_ingest");
  assert.ok(source.includes("event_id:"), "Must include event_id for idempotency");
});

test("worker: marks events delivered (delivered_at + last_error null)", () => {
  const source = readSource(WORKER_PATH);
  assert.ok(source.includes("markDelivered"), "Must have markDelivered");
  assert.ok(source.includes("delivered_at = now()"), "Must set delivered_at on success");
  assert.ok(source.includes("last_error = null"), "Must clear last_error on success");
});

test("worker: marks events failed (attempts + last_error)", () => {
  const source = readSource(WORKER_PATH);
  assert.ok(source.includes("markFailed"), "Must have markFailed");
  assert.ok(source.includes("attempts = attempts + 1"), "Must increment attempts on failure");
  assert.ok(source.includes("last_error = $2"), "Must set last_error on failure");
});

test("worker: has per-row backoff on failure (cap 30s)", () => {
  const source = readSource(WORKER_PATH);
  assert.ok(source.includes("perRowBackoff"), "Must have perRowBackoff function");
  assert.ok(
    source.includes("PER_ROW_BACKOFF_CAP_MS") || source.includes("30_000") || source.includes("30000"),
    "Per-row backoff must cap at 30s",
  );
});

// ─── Worker: adapter + infra ──────────────────────────────────────────────────

test("worker: pulseCall adapter uses AbortSignal.timeout", () => {
  const source = readSource(WORKER_PATH);
  assert.ok(source.includes("pulseCall"), "Must have pulseCall adapter");
  assert.ok(
    source.includes("AbortSignal.timeout"),
    "pulseCall must use AbortSignal.timeout",
  );
});

test("worker: pulseCall sends x-pulse-mcp-key header", () => {
  const source = readSource(WORKER_PATH);
  assert.ok(
    source.includes("x-pulse-mcp-key"),
    "Must send x-pulse-mcp-key header",
  );
});

test("worker: has graceful shutdown", () => {
  const source = readSource(WORKER_PATH);
  assert.ok(source.includes("SIGTERM"), "Must handle SIGTERM");
  assert.ok(source.includes("SIGINT"), "Must handle SIGINT");
  assert.ok(source.includes("pool.end"), "Must close pool on shutdown");
});

test("worker: uses raw pg driver (not Supabase client)", () => {
  const source = readSource(WORKER_PATH);
  assert.ok(
    source.includes('from "pg"') || source.includes("from 'pg'"),
    "Must use raw pg driver",
  );
  assert.ok(!source.includes("supabase"), "Must NOT use Supabase client");
});

test("worker: has claim owner and TTL", () => {
  const source = readSource(WORKER_PATH);
  assert.ok(source.includes("claim_owner"), "Must set claim_owner");
  assert.ok(source.includes("CLAIM_TTL_SECONDS"), "Must respect claim TTL");
});

// ─── Worker scaffold ─────────────────────────────────────────────────────────

test("worker: package.json exists", () => {
  assert.ok(
    fs.existsSync("services/buddy-core-worker/package.json"),
    "package.json must exist",
  );
});

test("worker: tsconfig.json exists", () => {
  assert.ok(
    fs.existsSync("services/buddy-core-worker/tsconfig.json"),
    "tsconfig.json must exist",
  );
});

test("worker: Dockerfile exists", () => {
  assert.ok(
    fs.existsSync("services/buddy-core-worker/Dockerfile"),
    "Dockerfile must exist",
  );
});

test("worker: Dockerfile uses node:22-slim", () => {
  const source = readSource("services/buddy-core-worker/Dockerfile");
  assert.ok(source.includes("node:22-slim"), "Dockerfile must use node:22-slim");
});

test("worker: package.json has pg dependency", () => {
  const source = readSource("services/buddy-core-worker/package.json");
  assert.ok(source.includes('"pg"'), "package.json must include pg dependency");
});

test("worker: README exists with deploy command", () => {
  assert.ok(
    fs.existsSync("services/buddy-core-worker/README.md"),
    "README.md must exist",
  );
  const source = readSource("services/buddy-core-worker/README.md");
  assert.ok(source.includes("gcloud run deploy"), "README must include gcloud deploy command");
  assert.ok(
    source.includes("buddy-core-worker@buddy-the-underwriter.iam.gserviceaccount.com"),
    "README must reference correct service account",
  );
  assert.ok(source.includes("--min-instances 1"), "README must set min-instances 1");
  assert.ok(source.includes("--set-secrets"), "README must mount secrets from Secret Manager");
});

test("worker: README has verification steps", () => {
  const source = readSource("services/buddy-core-worker/README.md");
  assert.ok(source.includes("gcloud run services logs read"), "README must include log tail command");
  assert.ok(
    source.includes("select count(*)") || source.includes("undelivered"),
    "README must include SQL to check undelivered backlog",
  );
});

// ─── Buddy no longer calls Pulse directly ────────────────────────────────────

test("buddy: instrumentation.ts has no heartbeat import", () => {
  const source = readSource(INSTRUMENTATION_PATH);
  assert.ok(
    !source.includes("startPulseMcpHeartbeat"),
    "instrumentation.ts must NOT import startPulseMcpHeartbeat",
  );
  assert.ok(
    !source.includes("pulseMcp/connection"),
    "instrumentation.ts must NOT import from pulseMcp/connection",
  );
});

test("buddy: connection.ts is removed", () => {
  assert.ok(
    !fs.existsSync("src/lib/pulseMcp/connection.ts"),
    "connection.ts must be removed (heartbeat moved to worker)",
  );
});

test("buddy: mcp-health route is removed", () => {
  assert.ok(
    !fs.existsSync("src/app/api/pulse/mcp-health/route.ts"),
    "mcp-health route must be removed (worker owns health now)",
  );
});

// ─── Pipeline event wiring at 5 points (still valid) ─────────────────────────

test("wiring: document upload emits pipeline event", () => {
  const source = readSource("src/lib/documents/ingestDocument.ts");
  assert.ok(source.includes("emitPipelineEvent"), "Must call emitPipelineEvent");
  assert.ok(source.includes("document_uploaded"), "Must emit document_uploaded event");
});

test("wiring: artifact processed emits pipeline event", () => {
  const source = readSource("src/lib/artifacts/processArtifact.ts");
  assert.ok(source.includes("emitPipelineEvent"), "Must call emitPipelineEvent");
  assert.ok(source.includes("artifact_processed"), "Must emit artifact_processed event");
});

test("wiring: checklist reconciled emits pipeline event", () => {
  const source = readSource("src/app/api/deals/[dealId]/checklist/reconcile/route.ts");
  assert.ok(source.includes("emitPipelineEvent"), "Must call emitPipelineEvent");
  assert.ok(source.includes("checklist_reconciled"), "Must emit checklist_reconciled event");
});

test("wiring: readiness recomputed emits pipeline event", () => {
  const source = readSource("src/lib/deals/readiness.ts");
  assert.ok(source.includes("emitPipelineEvent"), "Must call emitPipelineEvent");
  assert.ok(source.includes("readiness_recomputed"), "Must emit readiness_recomputed event");
});

test("wiring: manual override emits pipeline event", () => {
  const source = readSource("src/app/api/deals/[dealId]/documents/[attachmentId]/checklist-key/route.ts");
  assert.ok(source.includes("emitPipelineEvent"), "Must call emitPipelineEvent");
  assert.ok(source.includes("manual_override"), "Must emit manual_override event");
});

test("wiring: all pipeline emissions use void (fire-and-forget)", () => {
  const files = [
    "src/lib/documents/ingestDocument.ts",
    "src/lib/artifacts/processArtifact.ts",
    "src/app/api/deals/[dealId]/checklist/reconcile/route.ts",
    "src/lib/deals/readiness.ts",
    "src/app/api/deals/[dealId]/documents/[attachmentId]/checklist-key/route.ts",
  ];
  for (const f of files) {
    const source = readSource(f);
    assert.ok(
      source.includes("void emitPipelineEvent"),
      `${f}: emitPipelineEvent must be called with void (fire-and-forget)`,
    );
  }
});

// ─── Client module still exists (used by builder endpoints) ──────────────────

test("client: PulseMcpClient still available for builder endpoints", () => {
  assert.ok(
    fs.existsSync("src/lib/pulseMcp/client.ts"),
    "client.ts must still exist for builder/debug endpoints",
  );
  const source = readSource("src/lib/pulseMcp/client.ts");
  assert.ok(source.includes("AbortSignal.timeout"), "Client must use timeout");
});
