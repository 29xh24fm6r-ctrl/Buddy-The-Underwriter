/**
 * SPEC-CHECKLIST-STAGE-GATE-FIX-1 — Guard tests
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const READINESS_SRC = readFileSync(
  resolve(__dirname, "../../deals/readiness.ts"), "utf-8",
);
const ENGINE_SRC = readFileSync(
  resolve(__dirname, "../engine.ts"), "utf-8",
);

describe("SPEC-CHECKLIST-STAGE-GATE-FIX-1 guards", () => {
  test("computeDealReadiness checklist select includes required_years", () => {
    assert.ok(
      READINESS_SRC.includes("required_years"),
      "checklist select must include required_years for tolerance logic",
    );
  });

  test("computeDealReadiness checklist select includes satisfied_years", () => {
    assert.ok(
      READINESS_SRC.includes("satisfied_years"),
      "checklist select must include satisfied_years for tolerance logic",
    );
  });

  test("reconcileChecklistForDeal PFS_CURRENT falls back to canonical_type match", () => {
    assert.ok(
      ENGINE_SRC.includes('itemKey === "PFS_CURRENT"'),
      "Engine must have PFS_CURRENT canonical_type fallback",
    );
    assert.ok(
      ENGINE_SRC.includes('canonical_type === "PFS"'),
      "PFS fallback must match canonical_type PFS",
    );
  });

  test("checklist engine minMostRecentYear uses currentYear-2 after filing deadline", () => {
    assert.ok(
      ENGINE_SRC.includes("currentYear - 2;"),
      "After filing deadline, minMostRecentYear must be currentYear-2 (not currentYear-1)",
    );
  });
});
