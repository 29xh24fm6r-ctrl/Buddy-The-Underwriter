import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// Phase 14 — Spread Processor Reliability Governance Tests
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "../../../../..");

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(ROOT, relPath), "utf-8");
}

// ---------------------------------------------------------------------------
// BLOCKER A: Worker tick exports maxDuration
// ---------------------------------------------------------------------------

test("worker tick route exports maxDuration >= 300", () => {
  const src = readFile("src/app/api/jobs/worker/tick/route.ts");
  const match = src.match(/export\s+const\s+maxDuration\s*=\s*(\d+)/);
  assert.ok(match, "Worker tick must export maxDuration");
  const value = Number(match[1]);
  assert.ok(value >= 300, `maxDuration must be >= 300, got ${value}`);
});

test("worker tick SPREADS default batch size is 1", () => {
  const src = readFile("src/app/api/jobs/worker/tick/route.ts");
  const match = src.match(/const\s+defaultBatch\s*=\s*type\s*===\s*"SPREADS"\s*\?\s*(\d+)/);
  assert.ok(match, "Must define default batch for SPREADS");
  assert.equal(Number(match[1]), 1, "SPREADS default batch must be 1");
});

// ---------------------------------------------------------------------------
// Fix 5: CAS guard on spread job completion
// ---------------------------------------------------------------------------

test("spread job completion uses CAS guard (status + lease_owner)", () => {
  const src = readFile("src/lib/jobs/processors/spreadsProcessor.ts");

  // The SUCCEEDED update path must include CAS conditions
  // Look for .eq("status", "RUNNING").eq("lease_owner", leaseOwner) near SUCCEEDED
  const succeededBlock = src.slice(
    src.indexOf('"SUCCEEDED"'),
    src.indexOf('"SUCCEEDED"') + 500,
  );
  assert.ok(
    succeededBlock.includes('.eq("status", "RUNNING")'),
    "SUCCEEDED completion must include .eq('status', 'RUNNING') CAS guard",
  );
  assert.ok(
    succeededBlock.includes('.eq("lease_owner", leaseOwner)'),
    "SUCCEEDED completion must include .eq('lease_owner', leaseOwner) CAS guard",
  );
});

test("CAS rejection emits Aegis event", () => {
  const src = readFile("src/lib/jobs/processors/spreadsProcessor.ts");
  assert.ok(
    src.includes("SPREAD_JOB_COMPLETION_CAS_REJECTED"),
    "Must emit SPREAD_JOB_COMPLETION_CAS_REJECTED Aegis event on CAS failure",
  );
});

// ---------------------------------------------------------------------------
// Fix 6: Permanent error pruning
// ---------------------------------------------------------------------------

test("permanent error set exists with expected codes", () => {
  const src = readFile("src/lib/jobs/processors/spreadsProcessor.ts");

  assert.ok(
    src.includes("PERMANENT_ERRORS"),
    "Must define PERMANENT_ERRORS set",
  );
  assert.ok(
    src.includes('"TEMPLATE_NOT_FOUND"'),
    "TEMPLATE_NOT_FOUND must be in permanent errors",
  );
  assert.ok(
    src.includes('"SCHEMA_VALIDATION_FAILED"'),
    "SCHEMA_VALIDATION_FAILED must be in permanent errors",
  );
  assert.ok(
    src.includes('"UNKNOWN_SPREAD_TYPE"'),
    "UNKNOWN_SPREAD_TYPE must be in permanent errors",
  );
});

test("permanent errors skip retry and go straight to FAILED", () => {
  const src = readFile("src/lib/jobs/processors/spreadsProcessor.ts");
  assert.ok(
    src.includes("isPermanent"),
    "Must use isPermanent flag for retry pruning",
  );
  // Verify the condition: isPermanent || attempt >= maxAttempts
  assert.ok(
    src.includes("isPermanent || attempt >= maxAttempts"),
    "Must fail immediately on permanent errors",
  );
});

// ---------------------------------------------------------------------------
// Fix 7: Exponential preflight backoff
// ---------------------------------------------------------------------------

test("preflight backoff is exponential (not fixed 30s)", () => {
  const src = readFile("src/lib/jobs/processors/spreadsProcessor.ts");

  // Must contain exponential backoff formula
  assert.ok(
    src.includes("Math.pow(2, preflightRetries)"),
    "Preflight backoff must use Math.pow(2, preflightRetries) for exponential",
  );

  // Must NOT contain fixed 30_000 for preflight
  const preflightSection = src.slice(
    src.indexOf("preflightRetries < 5"),
    src.indexOf("preflightRetries < 5") + 300,
  );
  assert.ok(
    !preflightSection.includes("30_000"),
    "Preflight must NOT use fixed 30_000ms delay",
  );
});

// ---------------------------------------------------------------------------
// Fix 4: backfillFromSpreads returns ok:false on all-fail
// ---------------------------------------------------------------------------

test("backfillFromSpreads returns ok:false when all writes fail", () => {
  const src = readFile("src/lib/financialFacts/backfillFromSpreads.ts");
  assert.ok(
    src.includes("writes.length > 0 && factsWritten === 0"),
    "Must check for all-writes-failed condition",
  );
  assert.ok(
    src.includes("All") && src.includes("fact writes failed"),
    "Must return descriptive error on all-fail",
  );
});

// ---------------------------------------------------------------------------
// Fix 2: OCR timeout protection
// ---------------------------------------------------------------------------

test("Gemini OCR has per-model timeout protection", () => {
  const src = readFile("src/lib/ocr/runGeminiOcrJob.ts");
  assert.ok(
    src.includes("OCR_TIMEOUT_MS"),
    "Must define OCR_TIMEOUT_MS constant",
  );
  assert.ok(
    src.includes("Promise.race"),
    "Must use Promise.race for timeout",
  );

  // Timeout should try next model, not immediately throw
  assert.ok(
    src.includes("isTimeout"),
    "Must handle timeout errors to try next model",
  );
});
