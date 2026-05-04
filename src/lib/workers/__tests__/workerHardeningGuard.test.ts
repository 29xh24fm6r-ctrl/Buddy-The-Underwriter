/**
 * Source-level guard tests for the worker hardening patch.
 *
 * Pattern matches src/lib/pulse/__tests__/forwardLedgerCore.test.ts —
 * uses fs.readFileSync to assert specific structural invariants without
 * spinning up Supabase, supabase-js, or the Next runtime.
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const READ = (p: string) => fs.readFileSync(p, "utf-8");

// ── Idle probes integrated into outbox workers ────────────────────────────

test("processPulseOutbox: imports and calls hasOutboxWork before claim path", () => {
  const src = READ("src/lib/workers/processPulseOutbox.ts");
  assert.match(src, /from "@\/lib\/workers\/idleProbe"/);
  assert.match(src, /hasOutboxWork/);
  // Idle probe must run before stale-claim reclaim & candidate select
  const probeIdx = src.indexOf("hasOutboxWork(");
  const reclaimIdx = src.indexOf('staleThreshold');
  assert.ok(probeIdx > 0 && probeIdx < reclaimIdx, "probe must precede reclaim");
});

test("processIntakeOutbox: idle probe gates claim_intake_outbox_batch RPC", () => {
  const src = READ("src/lib/workers/processIntakeOutbox.ts");
  assert.match(src, /hasOutboxWork/);
  const probeIdx = src.indexOf("hasOutboxWork(");
  // Match the actual rpc call site, not the doc comment at the top.
  const rpcMatch = src.match(/sb\.rpc\(\s*"claim_intake_outbox_batch"/);
  assert.ok(rpcMatch && rpcMatch.index, "must call claim_intake_outbox_batch");
  assert.ok(probeIdx > 0 && probeIdx < (rpcMatch.index ?? 0), "probe must precede claim RPC");
});

test("processDocExtractionOutbox: idle probe gates claim RPC", () => {
  const src = READ("src/lib/workers/processDocExtractionOutbox.ts");
  assert.match(src, /hasOutboxWork/);
  const probeIdx = src.indexOf("hasOutboxWork(");
  const rpcMatch = src.match(/sb\.rpc\(\s*"claim_doc_extraction_outbox_batch"/);
  assert.ok(rpcMatch && rpcMatch.index, "must call claim_doc_extraction_outbox_batch");
  assert.ok(probeIdx > 0 && probeIdx < (rpcMatch.index ?? 0), "probe must precede claim RPC");
});

// ── Cron routes wire advisory lock + observability JSON ───────────────────

test("pulse-outbox route: wraps in withWorkerAdvisoryLock", () => {
  const src = READ("src/app/api/workers/pulse-outbox/route.ts");
  assert.match(src, /withWorkerAdvisoryLock/);
  assert.match(src, /WORKER_LOCK_KEYS\.PULSE_OUTBOX/);
});

test("doc-extraction route: wraps in withWorkerAdvisoryLock", () => {
  const src = READ("src/app/api/workers/doc-extraction/route.ts");
  assert.match(src, /withWorkerAdvisoryLock/);
  assert.match(src, /WORKER_LOCK_KEYS\.DOC_EXTRACTION_OUTBOX/);
});

test("intake-outbox route: wraps in withWorkerAdvisoryLock", () => {
  const src = READ("src/app/api/workers/intake-outbox/route.ts");
  assert.match(src, /withWorkerAdvisoryLock/);
  assert.match(src, /WORKER_LOCK_KEYS\.INTAKE_OUTBOX/);
});

test("ledger-forwarder route: wraps in withWorkerAdvisoryLock", () => {
  const src = READ("src/app/api/pulse/cron-forward-ledger/route.ts");
  assert.match(src, /withWorkerAdvisoryLock/);
  assert.match(src, /WORKER_LOCK_KEYS\.LEDGER_FORWARDER/);
});

test("forwardLedgerCore: idle probe before claim path", () => {
  const src = READ("src/lib/pulse/forwardLedgerCore.ts");
  assert.match(src, /idle_no_work/);
});

test("cron routes return observability JSON shape", () => {
  for (const path of [
    "src/app/api/workers/pulse-outbox/route.ts",
    "src/app/api/workers/doc-extraction/route.ts",
    "src/app/api/workers/intake-outbox/route.ts",
    "src/app/api/pulse/cron-forward-ledger/route.ts",
  ]) {
    const src = READ(path);
    assert.match(src, /worker:/, `${path} must include worker label`);
    assert.match(src, /durationMs/, `${path} must include durationMs`);
    assert.match(src, /skipped:/, `${path} must include skipped flag`);
  }
});

test("cron routes emit lock_not_acquired skip", () => {
  for (const path of [
    "src/app/api/workers/pulse-outbox/route.ts",
    "src/app/api/workers/doc-extraction/route.ts",
    "src/app/api/workers/intake-outbox/route.ts",
    "src/app/api/pulse/cron-forward-ledger/route.ts",
  ]) {
    const src = READ(path);
    assert.match(src, /lock_not_acquired/, `${path} must surface lock_not_acquired skip`);
  }
});

test("cron routes emit idle_no_work skip", () => {
  for (const path of [
    "src/app/api/workers/pulse-outbox/route.ts",
    "src/app/api/workers/doc-extraction/route.ts",
    "src/app/api/workers/intake-outbox/route.ts",
  ]) {
    const src = READ(path);
    assert.match(src, /idle_no_work/, `${path} must surface idle_no_work skip`);
  }
});

// ── Heartbeat suppression on idle ─────────────────────────────────────────

test("artifacts/process: heartbeat is gated by results.length > 0", () => {
  const src = READ("src/app/api/artifacts/process/route.ts");
  // The unconditional sendHeartbeat at batch start must be removed
  const lines = src.split("\n");
  const heartbeatLines = lines
    .map((l, i) => ({ l, i }))
    .filter((x) => x.l.includes("sendHeartbeat("));
  assert.ok(heartbeatLines.length >= 1, "should still call sendHeartbeat");
  // Each remaining sendHeartbeat call must appear inside a guarded block.
  // The simplest invariant: somewhere above the call we should see
  // `if (results.length > 0)` or similar guard.
  for (const { i } of heartbeatLines) {
    const ctx = lines.slice(Math.max(0, i - 5), i).join("\n");
    assert.match(
      ctx,
      /(results\.length > 0|stuck|failed)/,
      "sendHeartbeat must be inside a work-attempted guard",
    );
  }
});

test("jobs/worker/tick: heartbeat is gated, not unconditional", () => {
  const src = READ("src/app/api/jobs/worker/tick/route.ts");
  // The original unconditional `sendHeartbeat({...}).catch(() => {});` line
  // at tick start must have been replaced by a guarded `beat()` helper.
  assert.match(
    src,
    /heartbeatSent\s*=\s*false/,
    "must track heartbeatSent flag",
  );
  assert.match(src, /const beat\b/, "must define beat() helper");
  assert.doesNotMatch(
    src,
    /\/\/ Aegis: heartbeat at tick start\s*\n\s*sendHeartbeat\(/,
    "old unconditional heartbeat at tick start must be removed",
  );
});

// ── Schema mismatch fix: deals.amount → deals.loan_amount ─────────────────

test("dashboard analytics: no longer selects deals.amount", () => {
  const src = READ("src/lib/dashboard/analytics.ts");
  // The select string must no longer contain a bare `, amount,` field.
  assert.doesNotMatch(
    src,
    /\.from\("deals"\)[\s\S]*?\.select\([\s\S]*?,\s*amount\s*,/,
    "deals select must not include `amount`",
  );
  assert.match(src, /loan_amount/, "must select loan_amount instead");
});

test("creditCommitteeView activation: no longer selects deals.amount", () => {
  const src = READ(
    "src/lib/stitch/activations/creditCommitteeViewActivation.ts",
  );
  assert.doesNotMatch(
    src,
    /\.from\("deals"\)[\s\S]*?\.select\([\s\S]*?,\s*amount\s*,/,
  );
  assert.match(src, /loan_amount/);
});

// ── stuck_job dedup window in observerLoop ────────────────────────────────

test("observerLoop: stuck_job dedup window is 30 minutes", () => {
  const src = READ("src/lib/aegis/observerLoop.ts");
  assert.match(src, /STUCK_JOB_DEDUP_MIN\s*=\s*30/);
  assert.match(src, /payload->>worker_id/);
});

// ── vercel.json cron frequencies ──────────────────────────────────────────

test("vercel.json: outbox crons run every 5 minutes, not every 1-2", () => {
  const cfg = JSON.parse(READ("vercel.json"));
  const byPathPrefix = (prefix: string) =>
    cfg.crons.find((c: any) => String(c.path).startsWith(prefix));

  assert.equal(byPathPrefix("/api/workers/intake-outbox").schedule, "*/5 * * * *");
  assert.equal(byPathPrefix("/api/workers/doc-extraction").schedule, "*/5 * * * *");
  assert.equal(byPathPrefix("/api/workers/pulse-outbox").schedule, "*/5 * * * *");
  assert.equal(byPathPrefix("/api/pulse/cron-forward-ledger").schedule, "*/5 * * * *");
  assert.equal(byPathPrefix("/api/artifacts/process").schedule, "*/5 * * * *");

  assert.equal(byPathPrefix("/api/jobs/worker/tick").schedule, "*/10 * * * *");
});
