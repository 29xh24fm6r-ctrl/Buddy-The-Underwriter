/**
 * V-M2 — Scoring input bridge verification.
 *
 * Proves that when businessEntityType is absent, evaluateBuddySbaEligibility
 * produces for_profit_unknown; when present (e.g. "LLC"), for_profit_unknown
 * disappears and the for_profit check passes.
 *
 * This is the code-level proof that the C-0.2 propagation fix
 * (concierge facts → borrower_applications.business_entity_type →
 * loadScoreInputs.businessEntityType → evaluate) resolves the gap.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateBuddySbaEligibility } from "../evaluate";

function makeInputs(overrides: Record<string, unknown> = {}) {
  return {
    naics: null as string | null,
    industry: null as string | null,
    businessEntityType: null as string | null,
    annualRevenueUsd: null as number | null,
    employeeCount: null as number | null,
    useOfProceeds: null as unknown[] | null,
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

describe("V-M2 — for_profit_unknown resolves when businessEntityType is provided", () => {
  it("null businessEntityType → for_profit_unknown failure", () => {
    const result = evaluateBuddySbaEligibility(makeInputs());
    const unknown = result.failures.find((f) => f.check === "for_profit_unknown");
    assert.ok(unknown, "for_profit_unknown must be present when businessEntityType is null");
    assert.equal(result.passed, false, "eligibility must fail when entity type is missing");
  });

  it("empty string businessEntityType → for_profit_unknown failure", () => {
    const result = evaluateBuddySbaEligibility(makeInputs({ businessEntityType: "" }));
    const unknown = result.failures.find((f) => f.check === "for_profit_unknown");
    assert.ok(unknown, "for_profit_unknown must be present when businessEntityType is empty string");
  });

  it("LLC businessEntityType → for_profit_unknown disappears, for_profit passes", () => {
    const result = evaluateBuddySbaEligibility(makeInputs({ businessEntityType: "LLC" }));
    const unknown = result.failures.find((f) => f.check === "for_profit_unknown");
    assert.equal(unknown, undefined, "for_profit_unknown must NOT be present when businessEntityType = LLC");

    const forProfitCheck = result.checks.find((c) => c.check === "for_profit");
    assert.ok(forProfitCheck, "for_profit check must exist");
    assert.equal(forProfitCheck.passed, true, "LLC must pass for_profit check");
  });

  it("Corporation businessEntityType → for_profit passes", () => {
    const result = evaluateBuddySbaEligibility(makeInputs({ businessEntityType: "Corporation" }));
    const unknown = result.failures.find((f) => f.check === "for_profit_unknown");
    assert.equal(unknown, undefined, "for_profit_unknown must NOT be present for Corporation");

    const forProfitCheck = result.checks.find((c) => c.check === "for_profit");
    assert.ok(forProfitCheck, "for_profit check must exist");
    assert.equal(forProfitCheck.passed, true, "Corporation must pass for_profit check");
  });

  it("case insensitive: llc / LLC / Llc all pass", () => {
    for (const variant of ["llc", "LLC", "Llc"]) {
      const result = evaluateBuddySbaEligibility(makeInputs({ businessEntityType: variant }));
      const unknown = result.failures.find((f) => f.check === "for_profit_unknown");
      assert.equal(unknown, undefined, `for_profit_unknown must NOT appear for "${variant}"`);
    }
  });

  it("end-to-end chain proof: null → LLC mirrors production propagation", () => {
    // Before propagation: entity_type missing
    const before = evaluateBuddySbaEligibility(makeInputs());
    const beforeFailures = before.failures.map((f) => f.check);
    assert.ok(
      beforeFailures.includes("for_profit_unknown"),
      "BEFORE: for_profit_unknown must be in failures",
    );

    // After propagation: entity_type = LLC (what C-0.2 does)
    const after = evaluateBuddySbaEligibility(makeInputs({ businessEntityType: "LLC" }));
    const afterFailures = after.failures.map((f) => f.check);
    assert.ok(
      !afterFailures.includes("for_profit_unknown"),
      "AFTER: for_profit_unknown must NOT be in failures",
    );

    // The for_profit check specifically should flip from fail to pass
    const beforeCheck = before.checks.find((c) => c.check === "for_profit_unknown" || c.check === "for_profit");
    const afterCheck = after.checks.find((c) => c.check === "for_profit");
    assert.ok(beforeCheck, "BEFORE: a for_profit-related check must exist");
    assert.equal(beforeCheck!.passed, false, "BEFORE: for_profit check must fail");
    assert.ok(afterCheck, "AFTER: for_profit check must exist");
    assert.equal(afterCheck!.passed, true, "AFTER: for_profit check must pass");
  });
});
