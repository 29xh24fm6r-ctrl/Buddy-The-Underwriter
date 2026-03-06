/**
 * Financial Intelligence Layer — Tests
 *
 * All tested functions are pure — no DB stubs needed.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { computeEbitda } from "../ebitdaEngine";
import { analyzeOfficerComp } from "../officerCompEngine";
import { buildGlobalCashFlow } from "../globalCashFlowBuilder";
import type { EntityContribution } from "../globalCashFlowBuilder";

describe("Financial Intelligence Layer", () => {
  // ── Test 1: EBITDA — standard add-backs ───────────────────────────

  it("EBITDA — standard add-backs compute correctly", () => {
    const facts: Record<string, number | null> = {
      ORDINARY_BUSINESS_INCOME: 325912,
      INTEREST_EXPENSE: 9068,
      DEPRECIATION: 191385,
    };

    const result = computeEbitda(facts, "FORM_1120");

    assert.equal(result.reportedOBI, 325912);
    assert.equal(result.adjustedEbitda, 526365); // 325912 + 9068 + 191385
    assert.equal(result.addBacks.length, 2);
    assert.ok(result.addBacks.some((ab) => ab.key === "INTEREST_EXPENSE"));
    assert.ok(result.addBacks.some((ab) => ab.key === "DEPRECIATION"));
    assert.ok(result.adjustedEbitdaComponents.includes("OBI"));
    assert.equal(result.warnings.length, 0);
  });

  // ── Test 2: EBITDA — partnership guaranteed payments ──────────────

  it("EBITDA — partnership guaranteed payments add-back included", () => {
    const facts: Record<string, number | null> = {
      ORDINARY_BUSINESS_INCOME: 200000,
      GUARANTEED_PAYMENTS: 50000,
      DEPRECIATION: 30000,
    };

    const result = computeEbitda(facts, "FORM_1065");

    assert.equal(result.adjustedEbitda, 280000); // 200000 + 50000 + 30000
    assert.ok(
      result.addBacks.some((ab) => ab.key === "GUARANTEED_PAYMENTS"),
      "Guaranteed payments should be in addBacks",
    );
    assert.ok(
      result.addBacks
        .find((ab) => ab.key === "GUARANTEED_PAYMENTS")
        ?.notes.includes("officer compensation equivalent"),
    );
  });

  // ── Test 3: EBITDA — interest-in-COGS warning ────────────────────

  it("EBITDA — interest-in-COGS warning triggers", () => {
    const facts: Record<string, number | null> = {
      ORDINARY_BUSINESS_INCOME: 100000,
      COST_OF_GOODS_SOLD: 200000,
      INTEREST_EXPENSE: null,
    };

    const result = computeEbitda(facts, "FORM_1120");

    assert.ok(
      result.warnings.some((w) => w.includes("interest may be embedded in COGS")),
      "Should warn about interest in COGS",
    );
    // No speculative add-back
    assert.ok(
      !result.addBacks.some((ab) => ab.key === "INTEREST_EXPENSE"),
      "Should NOT add speculative interest add-back",
    );
  });

  // ── Test 4: Officer comp — EXTREME_HIGH flag ─────────────────────

  it("Officer comp — EXTREME_HIGH flag with excess computation", () => {
    const facts: Record<string, number | null> = {
      OFFICER_COMPENSATION: 500000,
      GROSS_RECEIPTS: 800000,
    };

    const result = analyzeOfficerComp(facts, "FORM_1120");

    assert.equal(result.flag, "EXTREME_HIGH");
    assert.equal(result.marketRateEstimate, 80000); // 800000 * 0.10
    assert.equal(result.excessComp, 420000); // 500000 - 80000
    assert.equal(result.adjustedEbitdaImpact, 420000);
    assert.ok(result.notes.includes("exceeds 40%"));
  });

  // ── Test 5: Officer comp — EXTREME_LOW flag ──────────────────────

  it("Officer comp — EXTREME_LOW flag with distribution note", () => {
    const facts: Record<string, number | null> = {
      OFFICER_COMPENSATION: 5000,
      GROSS_RECEIPTS: 800000,
    };

    const result = analyzeOfficerComp(facts, "FORM_1120");

    assert.equal(result.flag, "EXTREME_LOW");
    assert.ok(result.notes.includes("distributions"));
    assert.equal(result.excessComp, null);
    assert.equal(result.adjustedEbitdaImpact, null);
  });

  // ── Test 6: Global cash flow — multi-entity positive ─────────────

  it("Global cash flow — multi-entity aggregation", () => {
    const entities: EntityContribution[] = [
      {
        entityName: "Main LLC",
        entityType: "OPERATING_ENTITY",
        grossIncome: 325912,
        ownershipPct: 1.0,
        allocatedIncome: null,
        debtObligations: 120000,
        netContribution: null,
        formType: "FORM_1065",
        taxYear: 2024,
      },
      {
        entityName: "Side Corp",
        entityType: "PASSTHROUGH",
        grossIncome: 80000,
        ownershipPct: 0.5,
        allocatedIncome: null,
        debtObligations: 0,
        netContribution: null,
        formType: "FORM_1120S",
        taxYear: 2024,
      },
    ];

    const result = buildGlobalCashFlow(entities);

    // Main: 325912 * 1.0 = 325912; Side: 80000 * 0.5 = 40000
    assert.equal(result.totalAllocatedIncome, 365912);
    assert.equal(result.totalDebtObligations, 120000);
    assert.equal(result.globalNetCashFlow, 245912);
    assert.equal(result.warnings.length, 0);
    assert.equal(result.entities.length, 2);
    assert.equal(result.entities[0].allocatedIncome, 325912);
    assert.equal(result.entities[1].allocatedIncome, 40000);
  });

  // ── Test 7: Global cash flow — missing ownership warning ─────────

  it("Global cash flow — missing ownership percentage warning", () => {
    const entities: EntityContribution[] = [
      {
        entityName: "Unknown Holdings",
        entityType: "PASSTHROUGH",
        grossIncome: 200000,
        ownershipPct: null,
        allocatedIncome: null,
        debtObligations: 0,
        netContribution: null,
        formType: "FORM_1065",
        taxYear: 2024,
      },
    ];

    const result = buildGlobalCashFlow(entities);

    assert.ok(
      result.warnings.some((w) => w.includes("Ownership percentage unknown")),
      "Should warn about missing ownership",
    );
    // When ownership is null, grossIncome is used directly
    assert.equal(result.entities[0].allocatedIncome, 200000);
  });
});
