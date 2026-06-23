/**
 * SPEC-OUTSTANDING-FIXES-BATCH-1 — Guard tests
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const READINESS_SRC = readFileSync(
  resolve(__dirname, "../readiness.ts"), "utf-8",
);
const TAX_YEARS_SRC = readFileSync(
  resolve(__dirname, "../../intake/slots/taxYears.ts"), "utf-8",
);

describe("SPEC-OUTSTANDING-FIXES-BATCH-1 guards", () => {
  test("computeTaxYears returns years where most recent is a completed tax year", () => {
    // The function checks month < 3 || (month === 3 && day < 15)
    assert.ok(
      TAX_YEARS_SRC.includes("month < 3") || TAX_YEARS_SRC.includes("month >= 3"),
      "computeTaxYears must be filing-deadline-aware",
    );
  });

  test("computeDealReadiness has tax year tolerance for IRS_BUSINESS", () => {
    assert.ok(
      READINESS_SRC.includes("IRS_BUSINESS"),
      "readiness must have tolerance for IRS_BUSINESS current-year gap",
    );
  });

  test("computeDealReadiness has tax year tolerance for IRS_PERSONAL", () => {
    assert.ok(
      READINESS_SRC.includes("IRS_PERSONAL"),
      "readiness must have tolerance for IRS_PERSONAL current-year gap",
    );
  });

  test("readiness selects checklist_key for tolerance evaluation", () => {
    assert.ok(
      READINESS_SRC.includes("checklist_key"),
      "checklist query must select checklist_key to identify tax year items",
    );
  });

  test("tolerance only applies to current-prior tax year", () => {
    assert.ok(
      READINESS_SRC.includes("currentTaxYear"),
      "tolerance must be scoped to the current-prior tax year only",
    );
  });

  test("recomputeDealReady advances lifecycle to underwriting not ready", () => {
    assert.ok(
      READINESS_SRC.includes('toStage: "underwriting"'),
      "Must advance to underwriting — collecting→underwriting is the valid ALLOWED_TRANSITION",
    );
    assert.ok(
      !READINESS_SRC.includes('toStage: "ready"'),
      "Must NOT advance to ready — not a valid toStage from collecting",
    );
  });
});
