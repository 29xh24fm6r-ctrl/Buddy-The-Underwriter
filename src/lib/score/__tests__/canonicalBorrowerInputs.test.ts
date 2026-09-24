import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
mockServerOnly();
const require = createRequire(import.meta.url);
let riskInput: any;
require.cache[require.resolve("../../sba/sbaRiskProfile")] = { loaded: true, exports: { buildSBARiskProfile: async (input: any) => {
  riskInput = input; return { industryFactor: {}, loanTermFactor: {}, hardBlockers: [] };
} } } as any;
const { loadScoreInputs } = require("../inputs");
test("canonical-only startup loads borrower and same-owner PFS without legacy application", async () => {
  const rows: any = {
    deals: { id: "d", bank_id: "b", borrower_id: "borrower", loan_amount: 950000 },
    borrowers: { legal_name: "Startup LLC", entity_type: "llc", naics_code: "722515" },
    borrower_concierge_sessions: { confirmed_facts: { package_answers: { B07: { value: "The business is preparing to open" }, K02: { value: "New franchise location" } } } },
    ownership_entities: [{ id: "owner" }],
    borrower_applicant_financials: [{ applicant_id: "owner", liquid_assets: 350000, net_worth: 750000 }],
    buddy_sba_assumptions: { status: "confirmed", loan_impact: { termMonths: 120 }, management_team: [{ yearsInIndustry: 8 }] },
    deal_financial_facts: [{ fact_key: "TOTAL_REVENUE", fact_value_num: 5000000 }], deal_collateral_items: [],
    buddy_sba_packages: { dscr_year1_downside: 1.44, sensitivity_scenarios: [{ name: "downside", dscrYear1: 1.44, dscrYear2: .74, dscrYear3: .08 }] },
  };
  const reads: string[] = [];
  const sb = { from(table: string) { reads.push(table); const result = { data: rows[table] ?? null, error: null }; const q: any = {
    select: () => q, eq: () => q, in: (_: string, ids: string[]) => { assert.deepEqual(ids, ["owner"]); return q; }, order: () => q, limit: () => q,
    maybeSingle: async () => result, then: (resolve: any) => Promise.resolve(result).then(resolve),
  }; return q; } };
  const input = await loadScoreInputs({ dealId: "d", sb });
  assert.equal(input.businessEntityType, "llc"); assert.equal(input.naics, "722515");
  assert.equal(input.isFranchise, true); assert.equal(input.franchise, null, "declaration is not verified franchise eligibility");
  assert.equal(input.yearsInBusiness, 0); assert.equal(input.applicants[0].liquidAssets, 350000);
  assert.equal(input.dscrStress, .08, "scoring cannot ignore a later-year downside collapse");
  assert.equal(input.applicants[0].netWorth, 750000); assert.equal(input.applicants[0].ficoScore, null);
  assert.equal(riskInput.termMonths, 120); assert.equal(riskInput.managementYearsInIndustry, 8);
  assert.ok(riskInput.facts.some((f: any) => f.fact_key === "YEARS_IN_BUSINESS" && f.value_numeric === 0));
  assert.ok(!reads.includes("borrower_applicants"));
  assert.equal(input.annualRevenueUsd, 5000000);
  assert.equal(input.averageAnnualReceiptsUsd, null, "single-year revenue cannot satisfy the size receipts test");
  rows.borrower_concierge_sessions.confirmed_facts.package_answers.B13 = { value: 0 };
  rows.borrower_concierge_sessions.confirmed_facts.package_answers.B14 = { value: "Pre-opening applicant; no affiliates; supporting records reviewed" };
  const updated = await loadScoreInputs({ dealId: "d", sb });
  assert.equal(updated.averageAnnualReceiptsUsd, 0);
  assert.equal(updated.annualRevenueUsd, 5000000, "receipts must not overwrite historical revenue used for repayment analysis");
});
