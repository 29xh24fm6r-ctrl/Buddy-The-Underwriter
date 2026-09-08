import test from "node:test";
import assert from "node:assert/strict";

import {
  completeRecomputeSpreadTypes,
  decideSpreadInput,
  planSpreadRenderPhases,
} from "../spreadExecutionPolicy";

test("a canonical recompute requests classic PDF in the same atomic job", () => {
  assert.deepEqual(
    completeRecomputeSpreadTypes(["STANDARD", "GLOBAL_CASH_FLOW"]),
    ["STANDARD", "GLOBAL_CASH_FLOW", "CLASSIC_PDF"],
  );
  assert.deepEqual(
    completeRecomputeSpreadTypes(["STANDARD", "CLASSIC_PDF"]),
    ["STANDARD", "CLASSIC_PDF"],
  );
});

test("spread recompute fails visibly when document extraction has not persisted inputs", () => {
  assert.equal(
    decideSpreadInput({ visibleFactCount: 0, heartbeatExists: false }),
    "missing",
  );
  assert.equal(
    decideSpreadInput({ visibleFactCount: 0, heartbeatExists: true }),
    "heartbeat_only",
  );
  assert.equal(
    decideSpreadInput({ visibleFactCount: 12, heartbeatExists: false }),
    "ready",
  );
});

test("global cash flow is excluded from the initial phase and rendered once at the end", () => {
  const plan = planSpreadRenderPhases([
    "STANDARD",
    "GLOBAL_CASH_FLOW",
    "BALANCE_SHEET",
  ]);

  assert.deepEqual(plan.initial, ["STANDARD", "BALANCE_SHEET"]);
  assert.equal(plan.finalGlobalCashFlow, true);
});

test("a job without global cash flow has no final render phase", () => {
  const plan = planSpreadRenderPhases(["STANDARD", "BALANCE_SHEET"]);
  assert.deepEqual(plan.initial, ["STANDARD", "BALANCE_SHEET"]);
  assert.equal(plan.finalGlobalCashFlow, false);
});
