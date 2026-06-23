/**
 * SPEC-INTAKE-OUTBOX-WORKER-CLAIM-PATH-1
 *
 * Source-level tripwire that hard-fails CI when the intake-outbox worker's
 * claim-path RPC names diverge from what the migration defines, or when
 * processIntakeOutbox stops surfacing claim_rpc_failed distinctly.
 *
 * Background: production was stuck because workerLock.ts called an RPC
 * (claim_intake_outbox_with_xact_lock) that did not exist in production
 * Supabase. The error was silently swallowed as "lock_not_acquired" and
 * looked like benign lock contention. These guards make that recurrence
 * impossible: if either side drifts, this test fails before deploy.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const READ = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

test("[claim-path-1] workerLock.ts maps intake-outbox to claim_intake_outbox_with_xact_lock", () => {
  const src = READ("src/lib/workers/workerLock.ts");
  assert.match(
    src,
    /"intake-outbox"\s*:\s*"claim_intake_outbox_with_xact_lock"/,
    "intake-outbox must route through the xact-lock wrapper RPC, not the base claim_intake_outbox_batch",
  );
});

test("[claim-path-2] workerLock.ts maps doc-extraction to claim_doc_extraction_with_xact_lock", () => {
  const src = READ("src/lib/workers/workerLock.ts");
  assert.match(
    src,
    /"doc-extraction"\s*:\s*"claim_doc_extraction_with_xact_lock"/,
    "doc-extraction must route through the xact-lock wrapper RPC, not the base claim_doc_extraction_outbox_batch",
  );
});

test("[claim-path-3] migration defines claim_intake_outbox_with_xact_lock with key 42001003", () => {
  const migrationSrc = READ(
    "supabase/migrations/20260701000000_worker_advisory_xact_lock.sql",
  );
  assert.match(
    migrationSrc,
    /CREATE OR REPLACE FUNCTION public\.claim_intake_outbox_with_xact_lock/,
    "migration must define public.claim_intake_outbox_with_xact_lock",
  );
  assert.match(
    migrationSrc,
    /pg_try_advisory_xact_lock\(\s*42001003\s*\)/,
    "wrapper must use pg_try_advisory_xact_lock with INTAKE_OUTBOX key 42001003",
  );
  assert.match(
    migrationSrc,
    /claim_intake_outbox_batch\s*\(/,
    "wrapper must delegate to existing claim_intake_outbox_batch",
  );
  assert.match(
    migrationSrc,
    /TO\s+service_role/,
    "wrapper must be granted to service_role",
  );
  assert.match(
    migrationSrc,
    /NOTIFY\s+pgrst,\s*'reload schema'/,
    "migration must reload PostgREST schema cache",
  );
});

test("[claim-path-4] claimWithXactLock distinguishes claim_rpc_failed from lock_not_acquired", () => {
  const src = READ("src/lib/workers/workerLock.ts");
  assert.match(
    src,
    /reason:\s*"claim_rpc_failed"/,
    "workerLock must expose a claim_rpc_failed reason variant",
  );
  assert.match(
    src,
    /isClaimRpcFailure/,
    "workerLock must export isClaimRpcFailure helper",
  );
  assert.match(
    src,
    /rpcName/,
    "ClaimRpcFailure must carry the RPC name that failed",
  );
  assert.match(
    src,
    /errorMessage/,
    "ClaimRpcFailure must carry the underlying error message",
  );
});

test("[claim-path-4b] claimWithXactLock distinguishes zero_work from lock_not_acquired and claim_rpc_failed", () => {
  const src = READ("src/lib/workers/workerLock.ts");
  assert.match(
    src,
    /export\s+function\s+isZeroWork/,
    "workerLock must export an isZeroWork helper so callers can label the empty-success outcome distinctly",
  );

  const consumerSrc = READ("src/lib/workers/processIntakeOutbox.ts");
  assert.match(
    consumerSrc,
    /isZeroWork/,
    "processIntakeOutbox must branch on isZeroWork rather than just checking rows.length",
  );
});

test("[claim-path-5] processIntakeOutbox surfaces claim_rpc_failed distinctly", () => {
  const src = READ("src/lib/workers/processIntakeOutbox.ts");
  assert.match(
    src,
    /isClaimRpcFailure/,
    "processIntakeOutbox must import and check isClaimRpcFailure",
  );
  assert.match(
    src,
    /claim_rpc_failed/,
    "processIntakeOutbox must surface the claim_rpc_failed signal",
  );
  assert.match(
    src,
    /intake\.processing_claim_rpc_failed/,
    "processIntakeOutbox must emit intake.processing_claim_rpc_failed ledger event",
  );
});

test("[claim-path-6] handleStuckRecovery skips reenqueue when worker is not claiming", () => {
  const src = READ("src/lib/intake/processing/handleStuckRecovery.ts");
  assert.match(
    src,
    /WORKER_NOT_CLAIMING_THRESHOLD_MS/,
    "handleStuckRecovery must define a worker-not-claiming threshold",
  );
  assert.match(
    src,
    /intake\.processing_worker_not_claiming/,
    "handleStuckRecovery must emit intake.processing_worker_not_claiming when claim path is broken",
  );
  assert.match(
    src,
    /claim_path_broken_or_cron_not_running/,
    "event meta must carry the claim_path_broken_or_cron_not_running reason",
  );
});

test("[claim-path-7] intake-outbox route surfaces claim_rpc_failed in JSON response (500)", () => {
  const src = READ(
    "src/app/api/workers/[...path]/_handlers/intake-outbox.ts",
  );
  assert.match(
    src,
    /claim_rpc_failed/,
    "intake-outbox handler must surface claim_rpc_failed in its response",
  );
  assert.match(
    src,
    /status:\s*500/,
    "intake-outbox handler must return non-200 status when claim RPC fails so cron monitoring catches it",
  );
});

test("[claim-path-8] vercel.json cron entry for intake-outbox exists and uses /api/workers/intake-outbox", () => {
  const src = READ("vercel.json");
  assert.match(
    src,
    /\/api\/workers\/intake-outbox/,
    "vercel.json must keep the intake-outbox cron entry",
  );
  // Lock-janitor cron must keep pointing to its dedicated route (which lives at
  // src/app/api/workers/lock-janitor/route.ts, not the [...path] dispatcher).
  assert.match(
    src,
    /\/api\/workers\/lock-janitor/,
    "vercel.json must keep the lock-janitor cron entry",
  );
});

test("[claim-path-9] lock-janitor handler exists at a routable path", () => {
  // Either the dedicated route or a [...path] handler must exist.
  let dedicated = "";
  try {
    dedicated = READ("src/app/api/workers/lock-janitor/route.ts");
  } catch {
    dedicated = "";
  }
  let dispatched = "";
  try {
    dispatched = READ(
      "src/app/api/workers/[...path]/_handlers/lock-janitor.ts",
    );
  } catch {
    dispatched = "";
  }
  assert.ok(
    dedicated.length > 0 || dispatched.length > 0,
    "lock-janitor cron in vercel.json must have either a dedicated route or a dispatched handler — never leave the cron pointing nowhere",
  );
});
