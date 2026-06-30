/**
 * SPEC-INCOME-STATEMENT-INTEGRITY-GATE-1 — income-statement integrity checks + severity.
 *
 * Covers getIncomeStatementSpec + validateDocumentFacts:
 *  - both identities foot → IS_GROSS_PROFIT + IS_OPERATING_INCOME passed, VERIFIED.
 *  - gross-profit off > $1 (op-income still foots) → one required flag failure →
 *    FLAGGED (NOT BLOCKED), the other check still passed.
 *  - missing OPERATING_INCOME → IS_OPERATING_INCOME skipped, IS_GROSS_PROFIT passed → PARTIAL.
 *
 * Numbers are the live OmniCare eefd62b3 income statements (spec §PIV).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

// Stub "server-only" so transitive imports don't throw in test context.
mockServerOnly();

describe("Income-statement integrity checks + severity", async () => {
  const { validateDocumentFacts } = await import("../identityValidator");
  const { getIncomeStatementSpec } = await import("../formSpecs/incomeStatement");
  const { getFormSpec } = await import("../index");

  // Source guard — getFormSpec routes INCOME_STATEMENT to the income-statement spec.
  // (OPERATING_INCOME ∈ CanonicalFactKey is enforced at compile time — the spec
  // binds it as an IdentityCheck operand, so tsc fails if it is absent.)
  it("[isi-guard] getFormSpec('INCOME_STATEMENT') returns the income-statement spec", () => {
    const spec = getFormSpec("INCOME_STATEMENT", 2025);
    assert.ok(spec);
    assert.equal(spec.formType, "INCOME_STATEMENT");
    assert.equal(spec.taxYear, 2025);
    const ids = spec.identityChecks.map(c => c.id).sort();
    assert.deepEqual(ids, ["IS_GROSS_PROFIT", "IS_OPERATING_INCOME"]);
    for (const c of spec.identityChecks) assert.equal(c.severity, "flag");
  });

  it("[isi-1] Dec-2025 income statement foots both identities → VERIFIED", () => {
    const spec = getIncomeStatementSpec(2025);
    const facts: Record<string, number | null> = {
      TOTAL_REVENUE: 25861373.14,
      COST_OF_GOODS_SOLD: 22041981.25,
      GROSS_PROFIT: 3819391.89,
      TOTAL_OPERATING_EXPENSES: 3156191.81,
      OPERATING_INCOME: 663200.08,
    };
    const result = validateDocumentFacts("doc-is-2025", spec, facts);

    assert.equal(result.status, "VERIFIED");
    assert.equal(result.formType, "INCOME_STATEMENT");
    assert.equal(result.taxYear, 2025);
    assert.equal(result.passedCount, 2);
    assert.equal(result.failedCount, 0);

    const gp = result.checkResults.find(r => r.checkId === "IS_GROSS_PROFIT");
    const oi = result.checkResults.find(r => r.checkId === "IS_OPERATING_INCOME");
    assert.ok(gp);
    assert.ok(oi);
    assert.equal(gp.passed, true);
    assert.equal(gp.skipped, false);
    assert.equal(oi.passed, true);
    assert.equal(oi.skipped, false);
  });

  it("[isi-2] gross-profit off > $1 (op-income still foots) → FLAGGED, other check still passed", () => {
    const spec = getIncomeStatementSpec(2025);
    const facts: Record<string, number | null> = {
      TOTAL_REVENUE: 25861373.14,
      COST_OF_GOODS_SOLD: 22041981.25,
      GROSS_PROFIT: 3819291.89, // $100 short → IS_GROSS_PROFIT fails $1 tolerance
      TOTAL_OPERATING_EXPENSES: 3156091.81, // shifted so IS_OPERATING_INCOME still foots
      OPERATING_INCOME: 663200.08,
    };
    const result = validateDocumentFacts("doc-is-off", spec, facts);

    assert.equal(result.status, "FLAGGED");
    assert.notEqual(result.status, "BLOCKED");
    assert.equal(result.failedCount, 1);
    assert.equal(result.passedCount, 1);

    const gp = result.checkResults.find(r => r.checkId === "IS_GROSS_PROFIT");
    const oi = result.checkResults.find(r => r.checkId === "IS_OPERATING_INCOME");
    assert.ok(gp);
    assert.ok(oi);
    assert.equal(gp.passed, false);
    assert.equal(gp.skipped, false);
    assert.equal(oi.passed, true); // the other identity still foots
    assert.equal(oi.skipped, false);
  });

  it("[isi-3] missing OPERATING_INCOME → IS_OPERATING_INCOME skipped, IS_GROSS_PROFIT passed → PARTIAL", () => {
    const spec = getIncomeStatementSpec(2025);
    const facts: Record<string, number | null> = {
      TOTAL_REVENUE: 25861373.14,
      COST_OF_GOODS_SOLD: 22041981.25,
      GROSS_PROFIT: 3819391.89,
      TOTAL_OPERATING_EXPENSES: 3156191.81,
      // OPERATING_INCOME absent
    };
    const result = validateDocumentFacts("doc-is-partial", spec, facts);

    assert.equal(result.status, "PARTIAL");
    assert.equal(result.skippedCount, 1);
    assert.equal(result.passedCount, 1);

    const gp = result.checkResults.find(r => r.checkId === "IS_GROSS_PROFIT");
    const oi = result.checkResults.find(r => r.checkId === "IS_OPERATING_INCOME");
    assert.ok(gp);
    assert.ok(oi);
    assert.equal(gp.passed, true);
    assert.equal(oi.skipped, true);
    assert.ok(oi.skipReason?.includes("OPERATING_INCOME"));
  });

  it("[isi-4] Mar-2026 income statement foots both identities → VERIFIED (second live period)", () => {
    const spec = getIncomeStatementSpec(2026);
    const facts: Record<string, number | null> = {
      TOTAL_REVENUE: 6317223.94,
      COST_OF_GOODS_SOLD: 5457440.58,
      GROSS_PROFIT: 859783.36,
      TOTAL_OPERATING_EXPENSES: 654670.89,
      OPERATING_INCOME: 205112.47,
    };
    const result = validateDocumentFacts("doc-is-2026", spec, facts);
    assert.equal(result.status, "VERIFIED");
    assert.equal(result.taxYear, 2026);
    assert.equal(result.passedCount, 2);
  });
});
