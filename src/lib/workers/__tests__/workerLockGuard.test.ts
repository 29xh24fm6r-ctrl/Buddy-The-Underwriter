/**
 * Source-level guard tests for SPEC-ADVISORY-LOCK-XACT-MIGRATION-1.
 *
 * Pattern matches workerHardeningGuard.test.ts — uses fs.readFileSync to
 * assert structural invariants without spinning up Supabase or the Next
 * runtime.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const READ = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

test("[worker-lock-1] workerLock.ts exports both withWorkerAdvisoryLock (legacy) and claimWithXactLock (preferred)", () => {
  const src = READ("src/lib/workers/workerLock.ts");
  assert.match(
    src,
    /export\s+async\s+function\s+withWorkerAdvisoryLock/,
    "withWorkerAdvisoryLock must still be exported (kept for pulse/ledger/spreads pending follow-up)",
  );
  assert.match(
    src,
    /export\s+async\s+function\s+claimWithXactLock/,
    "claimWithXactLock must be exported",
  );
});

test("[worker-lock-2] WORKER_LOCK_KEYS values are preserved (same bigints)", () => {
  const src = READ("src/lib/workers/workerLock.ts");
  assert.match(src, /PULSE_OUTBOX:\s*42001001/);
  assert.match(src, /DOC_EXTRACTION_OUTBOX:\s*42001002/);
  assert.match(src, /INTAKE_OUTBOX:\s*42001003/);
  assert.match(src, /LEDGER_FORWARDER:\s*42001004/);
  assert.match(src, /SPREADS_WORKER:\s*42001005/);
});

test("[worker-lock-3] migrated worker routes do NOT use withWorkerAdvisoryLock", () => {
  const routes = [
    "src/app/api/workers/doc-extraction/route.ts",
    "src/app/api/workers/intake-outbox/route.ts",
  ];
  for (const path of routes) {
    const src = READ(path);
    assert.doesNotMatch(
      src,
      /withWorkerAdvisoryLock/,
      `${path} must not use the legacy session-scoped lock helper`,
    );
  }
});

test("[worker-lock-4] migrated processors call claimWithXactLock with their worker name", () => {
  const docExtractSrc = READ("src/lib/workers/processDocExtractionOutbox.ts");
  assert.match(
    docExtractSrc,
    /claimWithXactLock\s*\(\s*\{[^}]*workerName:\s*["']doc-extraction["']/s,
    "processDocExtractionOutbox must call claimWithXactLock with workerName=doc-extraction",
  );

  const intakeSrc = READ("src/lib/workers/processIntakeOutbox.ts");
  assert.match(
    intakeSrc,
    /claimWithXactLock\s*\(\s*\{[^}]*workerName:\s*["']intake-outbox["']/s,
    "processIntakeOutbox must call claimWithXactLock with workerName=intake-outbox",
  );
});

test("[worker-lock-5] processors expose processClaimed* halves for direct-row processing", () => {
  // Splitting the claim path (xact-lock) from the per-row processing loop
  // is the structural change that allows future fan-out callers to claim
  // once and process without re-acquiring the lock.
  const docExtractSrc = READ("src/lib/workers/processDocExtractionOutbox.ts");
  assert.match(
    docExtractSrc,
    /export\s+async\s+function\s+processClaimedExtractionRows/,
    "processClaimedExtractionRows must be exported",
  );

  const intakeSrc = READ("src/lib/workers/processIntakeOutbox.ts");
  assert.match(
    intakeSrc,
    /export\s+async\s+function\s+processClaimedIntakeRows/,
    "processClaimedIntakeRows must be exported",
  );
});

test("[worker-lock-6] xact-lock migration file exists and creates the 3 expected functions", () => {
  const migrationSrc = READ(
    "supabase/migrations/20260701000000_worker_advisory_xact_lock.sql",
  );
  assert.match(migrationSrc, /claim_doc_extraction_with_xact_lock/);
  assert.match(migrationSrc, /claim_intake_outbox_with_xact_lock/);
  assert.match(migrationSrc, /release_stale_worker_advisory_locks/);
  // Must use transaction-scoped advisory lock, not session-scoped.
  assert.match(migrationSrc, /pg_try_advisory_xact_lock\(\s*42001002\s*\)/);
  assert.match(migrationSrc, /pg_try_advisory_xact_lock\(\s*42001003\s*\)/);
  assert.doesNotMatch(
    migrationSrc,
    /pg_try_advisory_lock\(\s*42001002\s*\)/,
    "doc-extraction wrapper must NOT use session-scoped pg_try_advisory_lock",
  );
  // Must reload schema cache so RPCs are immediately callable.
  assert.match(migrationSrc, /NOTIFY\s+pgrst,\s*'reload schema'/);
});

test("[worker-lock-7] lock-janitor route exists and is auth-gated", () => {
  const src = READ("src/app/api/workers/lock-janitor/route.ts");
  assert.match(src, /hasValidWorkerSecret/);
  assert.match(src, /release_stale_worker_advisory_locks/);
  // Conservative idle threshold (>= 60s).
  assert.match(src, /IDLE_THRESHOLD_SECONDS\s*=\s*\d{2,}/);
});

test("[worker-lock-8] janitor SQL only targets our lock-key range and idle postgrest connections", () => {
  const migrationSrc = READ(
    "supabase/migrations/20260701000000_worker_advisory_xact_lock.sql",
  );
  // Must restrict to advisory locks in our key range — never broaden to all advisory locks.
  assert.match(migrationSrc, /objid\s+BETWEEN\s+42001001\s+AND\s+42001005/);
  // Must only target idle postgrest connections.
  assert.match(migrationSrc, /application_name\s*=\s*'postgrest'/);
  assert.match(migrationSrc, /state\s*=\s*'idle'/);
});
