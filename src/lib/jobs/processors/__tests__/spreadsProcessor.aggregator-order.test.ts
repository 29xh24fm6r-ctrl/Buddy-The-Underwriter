/**
 * SPEC-FOUNDATION-V1 PR5a — spreadsProcessor aggregator ordering guard.
 *
 * Verifies the structural guarantee that runCashFlowAggregator is called
 * BEFORE computeTotalDebtService in the spreadsProcessor chain. This
 * ensures CASH_FLOW_AVAILABLE is populated when computeTotalDebtService
 * reads it for DSCR computation.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..", "..", "..", "..");
const SPREADS_PROCESSOR_PATH = join(
  REPO_ROOT,
  "src/lib/jobs/processors/spreadsProcessor.ts",
);

function read(): string {
  return readFileSync(SPREADS_PROCESSOR_PATH, "utf8");
}

test("[pr5a-order-1] spreadsProcessor calls runCashFlowAggregator", () => {
  const body = read();
  assert.match(
    body,
    /runCashFlowAggregator/,
    "spreadsProcessor must import and call runCashFlowAggregator.",
  );
});

test("[pr5a-order-2] runCashFlowAggregator is called BEFORE computeTotalDebtService", () => {
  const body = read();
  // Strip comments to avoid false positives from comment text
  const stripped = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const aggIdx = stripped.indexOf("runCashFlowAggregator(");
  const tdsIdx = stripped.indexOf("computeTotalDebtService(");
  assert.ok(aggIdx > 0, "runCashFlowAggregator call site not found");
  assert.ok(tdsIdx > aggIdx, "runCashFlowAggregator must be called BEFORE computeTotalDebtService");
});

test("[pr5a-order-3] runCashFlowAggregator is called AFTER backfillCanonicalFactsFromSpreads", () => {
  const body = read();
  const stripped = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const backfillIdx = stripped.indexOf("backfillCanonicalFactsFromSpreads(");
  const aggIdx = stripped.indexOf("runCashFlowAggregator(");
  assert.ok(backfillIdx > 0, "backfillCanonicalFactsFromSpreads call site not found");
  assert.ok(aggIdx > backfillIdx, "runCashFlowAggregator must be called AFTER backfillCanonicalFactsFromSpreads");
});

test("[pr5a-order-4] aggregator call is wrapped in try/catch (non-fatal)", () => {
  const body = read();
  // Find the aggregator call and verify it's inside a try block
  const aggIdx = body.indexOf("runCashFlowAggregator(");
  // Search backwards from the call for the nearest 'try {'
  const preceding = body.slice(Math.max(0, aggIdx - 500), aggIdx);
  assert.ok(
    preceding.includes("try {") || preceding.includes("try{"),
    "runCashFlowAggregator must be inside a try/catch block.",
  );
  // Search forwards for 'catch' within 2000 chars (PR5d added canonical
  // events between the aggregator result handling and the catch clause)
  const following = body.slice(aggIdx, aggIdx + 2000);
  assert.ok(
    following.includes("catch"),
    "Try block containing runCashFlowAggregator must have a catch clause.",
  );
});

test("[pr5a-order-5] aggregator emits ledger event on success", () => {
  const body = read();
  assert.match(
    body,
    /aggregator\.canonical_run/,
    "spreadsProcessor must emit an 'aggregator.canonical_run' ledger event on aggregator success.",
  );
});
