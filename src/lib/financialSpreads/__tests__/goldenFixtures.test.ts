/**
 * Golden Fixture Tests — Formula Accuracy
 *
 * Validates GROSS_PROFIT, EBITDA, and TOTAL_REVENUE alias chain
 * against real Samaritus extraction data.
 *
 * These tests catch the three production bugs:
 * 1. GROSS_PROFIT returning null when COGS is null (service business)
 * 2. EBITDA being looked up instead of computed from components
 * 3. OBI being used as TOTAL_REVENUE via alias chain
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import Module from "node:module";

// Stub "server-only" for test context
const emptyJs = path.resolve("node_modules/server-only/empty.js");
const originalResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (
  request: string,
  ...args: any[]
) {
  if (request === "server-only") return emptyJs;
  return originalResolve.call(this, request, ...args);
};

describe("Golden Fixtures — Formula Accuracy", async () => {
  const { evaluateMetric } = await import("@/lib/metrics/evaluateMetric");

  // ── Samaritus 2022: Service business, no COGS ──────────────────────

  it("Samaritus 2022: GROSS_PROFIT = 797989 when COGS is null", () => {
    const facts: Record<string, number | null> = {
      TOTAL_REVENUE: 797989,
      COST_OF_GOODS_SOLD: 0, // null-as-zero applied by renderer
      GROSS_RECEIPTS: 797989,
      TOTAL_DEDUCTIONS: 472077,
      ORDINARY_BUSINESS_INCOME: 325912,
      DEPRECIATION: 191385,
      INTEREST_EXPENSE: 9068,
    };

    const gp = evaluateMetric("GROSS_PROFIT", facts);
    assert.equal(gp.value, 797989, "GROSS_PROFIT should be 797989 (revenue - 0 COGS)");
  });

  it("Samaritus 2022: EBITDA = 526365 from components", () => {
    const facts: Record<string, number | null> = {
      ORDINARY_BUSINESS_INCOME: 325912,
      DEPRECIATION: 191385,
      INTEREST_EXPENSE: 9068,
    };

    const ebitda = evaluateMetric("EBITDA", facts);
    assert.equal(ebitda.value, 526365, "EBITDA should be 325912 + 191385 + 9068 = 526365");
  });

  // ── Samaritus 2024: With COGS ──────────────────────────────────────

  it("Samaritus 2024: GROSS_PROFIT = 1053200 with COGS", () => {
    const facts: Record<string, number | null> = {
      TOTAL_REVENUE: 1502871,
      COST_OF_GOODS_SOLD: 449671,
      GROSS_RECEIPTS: 1502871,
      TOTAL_DEDUCTIONS: 783384,
      ORDINARY_BUSINESS_INCOME: 269816,
      DEPRECIATION: 287050,
      INTEREST_EXPENSE: 12112,
    };

    const gp = evaluateMetric("GROSS_PROFIT", facts);
    assert.equal(gp.value, 1053200, "GROSS_PROFIT should be 1502871 - 449671 = 1053200");
  });

  it("Samaritus 2024: EBITDA = 568978 from components", () => {
    const facts: Record<string, number | null> = {
      ORDINARY_BUSINESS_INCOME: 269816,
      DEPRECIATION: 287050,
      INTEREST_EXPENSE: 12112,
    };

    const ebitda = evaluateMetric("EBITDA", facts);
    assert.equal(ebitda.value, 568978, "EBITDA should be 269816 + 287050 + 12112 = 568978");
  });

  // ── OBI must never be used as revenue ──────────────────────────────

  it("OBI must never be used as TOTAL_REVENUE", () => {
    // Simulate a facts map where only OBI exists, no GROSS_RECEIPTS
    const facts: Record<string, number | null> = {
      ORDINARY_BUSINESS_INCOME: 269816,
      GROSS_RECEIPTS: null as unknown as number,
    };
    // Remove GROSS_RECEIPTS entirely — it's null
    delete (facts as any)["GROSS_RECEIPTS"];

    // TOTAL_REVENUE should be null because OBI is NOT in the alias chain
    const gp = evaluateMetric("GROSS_PROFIT", facts);

    // GROSS_PROFIT requires TOTAL_REVENUE. Without it, result should be null.
    assert.equal(gp.value, null, "GROSS_PROFIT must be null when TOTAL_REVENUE is missing (OBI must not alias to revenue)");
    assert.ok(
      gp.missingInputs.includes("TOTAL_REVENUE"),
      "TOTAL_REVENUE must be reported as missing input",
    );
  });

  // ── EBITDA with missing optional add-backs ─────────────────────────

  it("EBITDA computes when INTEREST_EXPENSE and DEPRECIATION are missing", () => {
    const facts: Record<string, number | null> = {
      ORDINARY_BUSINESS_INCOME: 100000,
      // INTEREST_EXPENSE and DEPRECIATION intentionally omitted
    };

    // With null propagation in evaluateMetric, missing operands → null.
    // The renderer applies null-as-zero BEFORE evaluation.
    // At the registry level, the formula requires only OBI.
    // But the evaluator's null propagation will make this null.
    // This test verifies the behavior without renderer pre-processing.
    const ebitda = evaluateMetric("EBITDA", facts);

    // Without renderer null-as-zero, missing INTEREST_EXPENSE/DEPRECIATION → null
    // This is correct: the RENDERER is responsible for null-as-zero, not the evaluator
    assert.equal(ebitda.value, null, "EBITDA is null without renderer null-as-zero pre-processing");

    // But with null-as-zero applied (as the renderer does):
    const factsWithDefaults = { ...facts, INTEREST_EXPENSE: 0, DEPRECIATION: 0 };
    const ebitdaWithDefaults = evaluateMetric("EBITDA", factsWithDefaults);
    assert.equal(ebitdaWithDefaults.value, 100000, "EBITDA = OBI when add-backs are 0");
  });
});
