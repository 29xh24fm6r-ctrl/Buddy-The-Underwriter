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
  test("recomputeDealReady calls scheduleReadinessRefresh in not-ready path", () => {
    // scheduleReadinessRefresh must appear in the else branch (not-ready)
    const elseIdx = READINESS_SRC.indexOf("Deal not ready - clear timestamp");
    const refreshIdx = READINESS_SRC.indexOf("scheduleReadinessRefresh", elseIdx);
    assert.ok(
      elseIdx > 0 && refreshIdx > 0 && refreshIdx > elseIdx,
      "scheduleReadinessRefresh must be called in the not-ready else branch",
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
});
