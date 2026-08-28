/**
 * SPEC-READINESS-SYSTEM-UNIFICATION-1 — Guard tests
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const READINESS_SRC = readFileSync(
  resolve(__dirname, "../readiness.ts"), "utf-8",
);
const RECONCILER_SRC = readFileSync(
  resolve(__dirname, "../readiness/reconcileDealLifecycle.ts"), "utf-8",
);

describe("SPEC-READINESS-SYSTEM-UNIFICATION-1 guards", () => {
  test("recomputeDealReady schedules refresh after not-ready persistence and regression evidence", () => {
    const elseIdx = READINESS_SRC.indexOf("Deal not ready - persist and prove");
    const clearIdx = READINESS_SRC.indexOf(
      "readiness_clear_update_failed",
      elseIdx,
    );
    const revertedIdx = READINESS_SRC.indexOf(
      "readiness_reverted_event_failed",
      elseIdx,
    );
    const refreshIdx = READINESS_SRC.indexOf(
      "scheduleReadinessRefresh",
      elseIdx,
    );
    assert.ok(
      elseIdx > 0 &&
        clearIdx > elseIdx &&
        revertedIdx > clearIdx &&
        refreshIdx > revertedIdx,
      "scheduleReadinessRefresh must follow authoritative not-ready persistence and regression evidence",
    );
  });

  test("computeDealReadiness tolerates PFS_CURRENT when finalized PFS doc exists", () => {
    assert.ok(
      READINESS_SRC.includes('checklist_key === "PFS_CURRENT"'),
      "Must have PFS_CURRENT tolerance check",
    );
    assert.ok(
      READINESS_SRC.includes("PERSONAL_FINANCIAL_STATEMENT"),
      "PFS tolerance must check both PFS and PERSONAL_FINANCIAL_STATEMENT canonical types",
    );
  });

  test("reconcileDealLifecycle advances via advanceDealLifecycle", () => {
    assert.ok(
      RECONCILER_SRC.includes("advanceDealLifecycle"),
      "reconcileDealLifecycle must call advanceDealLifecycle for stage transitions",
    );
  });

  test("recomputeDealReady calls reconcileChecklistForDeal before computeDealReadiness", () => {
    const reconcileIdx = READINESS_SRC.indexOf("reconcileChecklistForDeal");
    const computeIdx = READINESS_SRC.indexOf("computeDealReadiness(dealId)", reconcileIdx);
    assert.ok(reconcileIdx > 0, "Must call reconcileChecklistForDeal");
    assert.ok(computeIdx > reconcileIdx, "reconcile must come before computeDealReadiness");
  });
});
