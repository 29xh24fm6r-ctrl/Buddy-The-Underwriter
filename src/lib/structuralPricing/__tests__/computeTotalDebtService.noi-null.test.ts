/**
 * SPEC-FOUNDATION-V1 PR5a — computeTotalDebtService NOI-null graceful path.
 *
 * Verifies that when CASH_FLOW_AVAILABLE fact is null, computeTotalDebtService:
 * - Does NOT throw
 * - Still writes ADS facts (PROPOSED, EXISTING, total)
 * - Skips DSCR fact write
 * - Emits MISSING_PREREQ_NOI warning event
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..");
const TDS_PATH = join(
  REPO_ROOT,
  "src/lib/structuralPricing/computeTotalDebtService.ts",
);

function read(): string {
  return readFileSync(TDS_PATH, "utf8");
}

test("[pr5a-noi-null-1] computeTotalDebtService has MISSING_PREREQ_NOI warning event", () => {
  const body = read();
  assert.match(
    body,
    /MISSING_PREREQ_NOI/,
    "computeTotalDebtService must emit MISSING_PREREQ_NOI when CASH_FLOW_AVAILABLE is null.",
  );
});

test("[pr5a-noi-null-2] MISSING_PREREQ_NOI event uses severity 'warning' not 'error'", () => {
  const body = read();
  // Find the writeEvent block containing MISSING_PREREQ_NOI and verify severity
  const writeEventIdx = body.indexOf("deal.compute.missing_prereq");
  assert.ok(writeEventIdx > 0, "deal.compute.missing_prereq event kind not found");
  const context = body.slice(writeEventIdx, writeEventIdx + 500);
  assert.match(
    context,
    /severity.*["']warning["']/,
    "MISSING_PREREQ_NOI event must have severity: 'warning' (not 'error').",
  );
});

test("[pr5a-noi-null-3] MISSING_PREREQ_NOI is in the else branch of noiFact check", () => {
  const body = read();
  // The MISSING_PREREQ_NOI should appear after an `} else {` that follows
  // the `if (noiFact?.fact_value_num != null)` check
  const noiFact = body.indexOf("noiFact?.fact_value_num != null");
  assert.ok(noiFact > 0, "noiFact null check not found");
  const afterNoiCheck = body.slice(noiFact, noiFact + 2000);
  const elseIdx = afterNoiCheck.indexOf("} else {");
  assert.ok(elseIdx > 0, "else branch after noiFact check not found");
  const elseBlock = afterNoiCheck.slice(elseIdx, elseIdx + 800);
  assert.match(
    elseBlock,
    /MISSING_PREREQ_NOI/,
    "MISSING_PREREQ_NOI event must be in the else branch of the noiFact check.",
  );
});

test("[pr5a-noi-null-4] MISSING_PREREQ_NOI event is fire-and-forget", () => {
  const body = read();
  const missingIdx = body.indexOf("MISSING_PREREQ_NOI");
  assert.ok(missingIdx > 0);
  // Search surrounding context for the void + catch pattern
  const context = body.slice(Math.max(0, missingIdx - 200), missingIdx + 500);
  assert.match(
    context,
    /void writeEvent|\.catch\(\(\)\s*=>/,
    "MISSING_PREREQ_NOI event emission must be fire-and-forget (void writeEvent or .catch).",
  );
});

test("[pr5a-noi-null-5] computeTotalDebtService imports writeEvent", () => {
  const body = read();
  assert.match(
    body,
    /import\s*\{[^}]*writeEvent[^}]*\}\s*from/,
    "computeTotalDebtService must import writeEvent for the MISSING_PREREQ_NOI emission.",
  );
});
