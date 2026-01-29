import test from "node:test";
import assert from "node:assert/strict";

// ─── Source-level structural tests ──────────────────────────────────────────

test("forwarder core: source exports forwardLedgerBatch", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync("src/lib/pulse/forwardLedgerCore.ts", "utf-8");
  assert.ok(
    source.includes("export async function forwardLedgerBatch"),
    "Must export forwardLedgerBatch",
  );
});

test("forwarder core: uses claim-based concurrency", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync("src/lib/pulse/forwardLedgerCore.ts", "utf-8");

  assert.ok(
    source.includes("pulse_forward_claimed_at"),
    "Must reference pulse_forward_claimed_at column",
  );
  assert.ok(
    source.includes("pulse_forward_claim_id"),
    "Must reference pulse_forward_claim_id column",
  );
  assert.ok(
    source.includes("randomUUID"),
    "Must generate a claim ID with randomUUID",
  );
});

test("forwarder core: implements deadletter after MAX_ATTEMPTS", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync("src/lib/pulse/forwardLedgerCore.ts", "utf-8");

  assert.ok(
    source.includes("MAX_ATTEMPTS"),
    "Must define MAX_ATTEMPTS constant",
  );
  assert.ok(
    source.includes("pulse_forward_deadletter_at"),
    "Must set deadletter timestamp on exhausted rows",
  );
});

test("forwarder core: reclaims stale claims", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync("src/lib/pulse/forwardLedgerCore.ts", "utf-8");

  assert.ok(
    source.includes("CLAIM_TTL"),
    "Must define claim TTL",
  );
  assert.ok(
    source.includes("staleThreshold"),
    "Must compute stale threshold for claim recovery",
  );
});

test("forwarder core: kill switch returns telemetry_disabled", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync("src/lib/pulse/forwardLedgerCore.ts", "utf-8");

  assert.ok(
    source.includes('"telemetry_disabled"'),
    "Must return telemetry_disabled when kill switch is off",
  );
});

test("forwarder core: clears claim fields on success", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync("src/lib/pulse/forwardLedgerCore.ts", "utf-8");

  // After successful forward, claimed_at and claim_id must be cleared
  assert.ok(
    source.includes("pulse_forward_claimed_at: null"),
    "Must clear claimed_at on success",
  );
  assert.ok(
    source.includes("pulse_forward_claim_id: null"),
    "Must clear claim_id on success",
  );
});

test("forwarder core: uses HMAC signing", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync("src/lib/pulse/forwardLedgerCore.ts", "utf-8");

  assert.ok(
    source.includes("x-pulse-signature"),
    "Must include HMAC signature header",
  );
  assert.ok(
    source.includes("createHmac"),
    "Must use HMAC for signing",
  );
});

test("forwarder core: 2-second timeout on ingest", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync("src/lib/pulse/forwardLedgerCore.ts", "utf-8");

  assert.ok(
    source.includes("2000") || source.includes("INGEST_TIMEOUT_MS"),
    "Must enforce 2s timeout on ingest fetch",
  );
  assert.ok(
    source.includes("AbortSignal.timeout"),
    "Must use AbortSignal.timeout",
  );
});

test("forwarder core: never throws", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync("src/lib/pulse/forwardLedgerCore.ts", "utf-8");

  // The function should catch errors, not let them propagate
  assert.ok(
    source.includes("catch"),
    "Must have try/catch blocks to prevent throwing",
  );
});

test("forwarder core: returns ForwardResult with required fields", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync("src/lib/pulse/forwardLedgerCore.ts", "utf-8");

  assert.ok(source.includes("claimId"), "Result must include claimId");
  assert.ok(source.includes("attempted"), "Result must include attempted");
  assert.ok(source.includes("forwarded"), "Result must include forwarded");
  assert.ok(source.includes("failed"), "Result must include failed count");
  assert.ok(source.includes("deadlettered"), "Result must include deadlettered count");
});

// ─── Route auth structural tests ────────────────────────────────────────────

test("forward-ledger route: Bearer-only auth, no WORKER_SECRET", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync("src/app/api/pulse/forward-ledger/route.ts", "utf-8");

  assert.ok(
    source.includes("PULSE_FORWARDER_TOKEN"),
    "Must check PULSE_FORWARDER_TOKEN",
  );
  assert.ok(
    !source.includes("WORKER_SECRET"),
    "Must NOT reference WORKER_SECRET",
  );
  assert.ok(
    !source.includes('searchParams.get("token")'),
    "Must NOT check query param token",
  );
});

test("cron-forward-ledger route: uses CRON_SECRET, no query params", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync("src/app/api/pulse/cron-forward-ledger/route.ts", "utf-8");

  assert.ok(
    source.includes("CRON_SECRET"),
    "Must check CRON_SECRET for cron auth",
  );
  assert.ok(
    source.includes("forwardLedgerBatch"),
    "Must call shared core function",
  );
});

test("health route: returns health metrics and checks degraded thresholds", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync("src/app/api/pulse/forward-ledger/health/route.ts", "utf-8");

  assert.ok(source.includes("backlog_unforwarded"), "Must report unforwarded backlog");
  assert.ok(source.includes("backlog_claimed"), "Must report claimed count");
  assert.ok(source.includes("deadlettered"), "Must report deadlettered count");
  assert.ok(source.includes("failed_last_hour"), "Must report recent failures");
  assert.ok(source.includes("max_attempts_seen"), "Must report max attempts");
  assert.ok(source.includes("emitObserverEvent"), "Must emit degraded signal");
  assert.ok(source.includes("pulse.forwarder"), "Degraded signal must reference pulse.forwarder");
});

// ─── Idempotency structural test ────────────────────────────────────────────

test("idempotency: claimed_at IS NULL guard prevents double-claim", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync("src/lib/pulse/forwardLedgerCore.ts", "utf-8");

  // The claim step must include the IS NULL guard
  // Count occurrences: claim step should use .is("pulse_forward_claimed_at", null)
  const claimGuardCount = (source.match(/\.is\("pulse_forward_claimed_at",\s*null\)/g) || []).length;
  assert.ok(
    claimGuardCount >= 2,
    `Must use IS NULL guard on pulse_forward_claimed_at in multiple places (selection + claim), found ${claimGuardCount}`,
  );
});

// ─── Concurrency structural test ────────────────────────────────────────────

test("concurrency: claim uses per-row atomic update", async () => {
  const fs = await import("node:fs");
  const source = fs.readFileSync("src/lib/pulse/forwardLedgerCore.ts", "utf-8");

  // The claim loop must update individual rows by ID with IS NULL guard
  assert.ok(
    source.includes('.eq("id", candidate.id)'),
    "Must claim rows individually by ID",
  );
  assert.ok(
    source.includes("maybeSingle"),
    "Must use maybeSingle to detect claim success",
  );
});

// ─── vercel.json: no secrets in cron URL ────────────────────────────────────

test("vercel.json: pulse cron has no secrets in URL", async () => {
  const fs = await import("node:fs");
  const config = JSON.parse(fs.readFileSync("vercel.json", "utf-8"));

  const pulseCron = config.crons.find(
    (c: { path: string }) => c.path.includes("pulse") && c.path.includes("cron"),
  );
  assert.ok(pulseCron, "Must have a pulse cron entry");
  assert.ok(
    !pulseCron.path.includes("token="),
    "Cron path must NOT contain token query param",
  );
  assert.ok(
    !pulseCron.path.includes("SECRET"),
    "Cron path must NOT contain SECRET",
  );
  assert.equal(pulseCron.schedule, "*/2 * * * *", "Must run every 2 minutes");
});
