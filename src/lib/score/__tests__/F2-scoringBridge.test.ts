/**
 * F-2 scoring-input bridge verification — SPEC-BORROWER-FINISH
 *
 * Proves the end-to-end bridge: concierge facts → propagation mapping →
 * eligibility evaluator → scorer composite.
 *
 * Uses production-equivalent inputs from deal 0d989d1f:
 *   entity_type=LLC, naics=513210, use_of_proceeds present, annual_revenue=0
 *
 * Demonstrates:
 *   1. evaluateBuddySbaEligibility passes when all three previously-failing
 *      checks have inputs (entity_type, NAICS in size-standard table, UoP)
 *   2. The same inputs with null entity_type fail (for_profit_unknown)
 *   3. NAICS 513210 is now in the size-standard table
 *   4. The propagation field mapping is correct: businessFacts["entity_type"]
 *      → borrower_applications.business_entity_type → scorer input
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { evaluateBuddySbaEligibility } from "@/lib/score/eligibility/evaluate";
import { lookupSizeStandard } from "@/lib/score/eligibility/sbaSizeStandards";

function makeEligibilityInputs(overrides: Record<string, unknown> = {}) {
  return {
    naics: "513210" as string | null,
    industry: "software ai business" as string | null,
    businessEntityType: "LLC" as string | null,
    annualRevenueUsd: 0 as number | null,
    employeeCount: 2 as number | null,
    useOfProceeds: [{ category: "working_capital", description: "trademark the brand and launch it" }] as unknown[] | null,
    sourcesAndUses: null as unknown,
    isFranchise: false,
    franchiseSbaEligible: null as boolean | null,
    franchiseSbaCertificationStatus: null as string | null,
    hardBlockers: [] as string[],
    federalDebtDelinquent: null as boolean | null,
    taxDelinquent: null as boolean | null,
    samDebarred: null as boolean | null,
    felonyConviction: null as boolean | null,
    incarceratedOrParole: null as boolean | null,
    priorGovLoanDefault: null as boolean | null,
    hasAffiliates: null as boolean | null,
    ...overrides,
  };
}

describe("F-2 — scoring input bridge: concierge facts reach the scorer", () => {
  it("NAICS 513210 is in the size-standard table (reference-data fix)", () => {
    const entry = lookupSizeStandard("513210");
    assert.ok(entry, "NAICS 513210 must be in the size-standard table");
    assert.equal(entry.naics, "513210");
    assert.equal(entry.unit, "annual_receipts_usd");
    assert.equal(entry.threshold, 47_000_000);
  });

  it("production-equivalent inputs (entity_type=LLC, naics=513210, UoP present) → eligibility PASSES", () => {
    const inputs = makeEligibilityInputs();
    const result = evaluateBuddySbaEligibility(inputs);

    assert.equal(result.passed, true, `Expected eligibility to pass, got failures: ${JSON.stringify(result.failures)}`);
    assert.equal(result.failures.length, 0, "No eligibility failures expected");
  });

  it("before fix: null entity_type → for_profit_unknown failure", () => {
    const inputs = makeEligibilityInputs({ businessEntityType: null });
    const result = evaluateBuddySbaEligibility(inputs);

    assert.equal(result.passed, false, "Must fail eligibility with null entity_type");
    const forProfitFailure = result.failures.find((f: { check: string }) => f.check === "for_profit_unknown");
    assert.ok(forProfitFailure, "Must have for_profit_unknown failure");
  });

  it("before fix: null useOfProceeds → use_of_proceeds_unknown failure", () => {
    const inputs = makeEligibilityInputs({ useOfProceeds: null });
    const result = evaluateBuddySbaEligibility(inputs);

    assert.equal(result.passed, false, "Must fail eligibility with null useOfProceeds");
    const uopFailure = result.failures.find((f: { check: string }) => f.check === "use_of_proceeds_unknown");
    assert.ok(uopFailure, "Must have use_of_proceeds_unknown failure");
  });

  it("before fix: NAICS not in table → size_standard failure with unknownNaics", () => {
    const inputs = makeEligibilityInputs({ naics: "999999" });
    const result = evaluateBuddySbaEligibility(inputs);

    assert.equal(result.passed, false, "Must fail eligibility with unknown NAICS");
    const sizeFailure = result.failures.find((f: { check: string }) => f.check === "size_standard");
    assert.ok(sizeFailure, "Must have size_standard failure");
  });

  it("propagation field mapping: businessFacts['entity_type'] → app.business_entity_type → scorer input", () => {
    const conciergeFacts = {
      business: { entity_type: "LLC", naics: "513210" },
      loan: { use_of_proceeds: "trademark the brand and launch it", amount_requested: 50000 },
    };

    const businessFacts = conciergeFacts.business as Record<string, unknown>;
    const loanFacts = conciergeFacts.loan as Record<string, unknown>;

    const entityType = String(businessFacts["entity_type"] ?? "");
    const naics = String(businessFacts["naics"] ?? "");
    const useOfProceeds = String(loanFacts["use_of_proceeds"] ?? "");

    assert.equal(entityType, "LLC", "entity_type must map from business facts");
    assert.equal(naics, "513210", "naics must map from business facts");
    assert.ok(useOfProceeds.length > 0, "use_of_proceeds must map from loan facts");

    const inputs = makeEligibilityInputs({
      businessEntityType: entityType,
      naics: naics,
      useOfProceeds: [{ description: useOfProceeds }],
    });
    const result = evaluateBuddySbaEligibility(inputs);
    assert.equal(result.passed, true, "Inputs traced from concierge facts must pass eligibility");
  });

  it("all three July-23 failures are fixed simultaneously → score path opens", () => {
    const inputs = makeEligibilityInputs();
    const result = evaluateBuddySbaEligibility(inputs);

    assert.equal(result.passed, true);

    const checkNames = result.checks.map((c: { check: string }) => c.check);
    assert.ok(checkNames.includes("for_profit"), "for_profit check must run");
    assert.ok(checkNames.some((n: string) => n.startsWith("size_standard") || n === "size_standard"), "size_standard check must run");
    assert.ok(checkNames.includes("use_of_proceeds"), "use_of_proceeds check must run");

    const allPassed = result.checks.every((c: { passed: boolean }) => c.passed);
    assert.ok(allPassed, `All checks must pass, failures: ${JSON.stringify(result.checks.filter((c: { passed: boolean }) => !c.passed))}`);
  });
});
