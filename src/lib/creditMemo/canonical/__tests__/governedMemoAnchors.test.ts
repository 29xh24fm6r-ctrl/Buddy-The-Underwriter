import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);
const { buildNarrativeInput } =
  require("../narrativeAssembly") as typeof import("../narrativeAssembly");

/**
 * Deal d4b7104f's real governed facts. TOTAL_LIABILITIES and
 * SL_TOTAL_LIABILITIES both carry 830000 at 2025-12-31, is_superseded false,
 * confidence 1 — they pass every filter in buildBalanceSheetTable.
 *
 * Bundle eb5a611c blocked on: "The debt figure of $830,000 is used as an
 * anchor for a chain of derived figures (EBITDA, revenue, net income,
 * assets), but $830,000 is not present in the governed top-level fields — it
 * only appears inside the ratio_suite interpretation."
 *
 * The generator and the verifier are handed the SAME payload — this function's
 * output — so a balance-sheet dollar that reaches only a ratio interpretation
 * is untraceable to both of them. These tests hold the anchors at the top
 * level, where a reviewer can find them.
 */
function memo(overrides: Record<string, unknown> = {}) {
  const zero = { value: 0 };
  return {
    header: { deal_name: "QA Machine Shop", borrower_name: "QA Machine Shop LLC" },
    key_metrics: {
      loan_amount: { value: 1_000_000 },
      product: "SBA 7(a)",
      rate_summary: "P+2.75%",
      dscr_uw: { value: 1.71 },
      dscr_stressed: { value: 0.86 },
      ltv_gross: zero,
      debt_yield: zero,
      cap_rate: zero,
      stabilization_status: "stabilized",
    },
    transaction_overview: { loan_request: { purpose: "Equipment", term_months: 120 } },
    financial_analysis: {
      noi: { value: 360_000 },
      cash_flow_available: { value: 360_000 },
      debt_service: { value: 137_616 },
      excess_cash_flow: { value: 222_384 },
      revenue: { value: 2_753_880 },
      ebitda: { value: 360_000 },
      net_income: { value: 210_000 },
      debt_coverage_table: [],
      ratio_analysis: [
        {
          category: "leverage",
          name: "Debt to Equity",
          value: 0.98,
          interpretation: "Total liabilities of $830,000 against equity of $850,000.",
        },
      ],
      balance_sheet_table: [
        {
          period_end: "2025-12-31",
          total_assets: 1_680_000,
          total_liabilities: 830_000,
          mortgages_notes_bonds: 620_000,
          total_equity: 850_000,
        },
      ],
    },
    business_summary: {
      seasonality: null,
      revenue_mix: null,
      geography: null,
      years_in_operation: null,
    },
    business_industry_analysis: null,
    stress_testing: null,
    qualitative_assessment: null,
    recommendation: { risk_grade: "5", verdict: "approve", headline: "Approve" },
    covenant_package: null,
    collateral: {
      gross_value: zero,
      net_value: zero,
      valuation: { as_is: zero, stabilized: zero },
    },
    risk_factors: [],
    policy_exceptions: [],
    borrower_sponsor: { sponsors: [] },
    global_cash_flow: { global_cash_flow: { value: 360_000 }, global_dscr: { value: 2.62 } },
    ...overrides,
  } as any;
}

test("every balance-sheet dollar a reviewer can cite is a governed top-level field", () => {
  const input = buildNarrativeInput(memo());

  assert.deepEqual(input.balance_sheet, [
    {
      period_end: "2025-12-31",
      total_assets: 1_680_000,
      total_liabilities: 830_000,
      long_term_debt: 620_000,
      total_equity: 850_000,
    },
  ]);
});

test("the $830,000 anchor is reachable without reading a ratio interpretation", () => {
  const input = buildNarrativeInput(memo());

  // The production failure: the figure existed only inside ratio_suite
  // commentary, which is an opinion about the number, not the number.
  const topLevelValues = JSON.stringify(input.balance_sheet);
  assert.match(topLevelValues, /830000/);
});

test("an empty balance-sheet table yields no anchors rather than fabricated ones", () => {
  const input = buildNarrativeInput(
    memo({
      financial_analysis: {
        ...memo().financial_analysis,
        balance_sheet_table: [],
      },
    }),
  );

  assert.deepEqual(input.balance_sheet, []);
});

test("the verifier is handed the same payload as the generator", async () => {
  // Behavioural, not a source-text match: drive verifyMemoNarratives and
  // capture the evidence it actually hands the reviewer. If a future change
  // enriches the generator's payload without enriching the reviewer's, every
  // extra figure becomes an "unsupported claim" — which is the shape of the
  // production failure this file exists for.
  let capturedFacts: unknown = null;

  require.cache[require.resolve("@/lib/ai/frontierArtifactFactory")] = {
    id: "factory-stub", filename: "factory-stub", loaded: true,
    exports: {
      finishInstitutionalArtifact: async (args: { facts: unknown; sections: unknown[] }) => {
        capturedFacts = args.facts;
        return {
          verdict: "pass",
          flaggedClaims: [],
          sections: args.sections,
          repaired: false,
          reviewPasses: 1,
          reviewIssues: [],
        };
      },
    },
  } as never;
  require.cache[require.resolve("@/lib/ai/artifactVerification")] = {
    id: "flags-stub", filename: "flags-stub", loaded: true,
    exports: {
      persistArtifactFlags: async () => ({ conditionsCreated: 0, conditionsSkipped: 0 }),
    },
  } as never;

  const { verifyMemoNarratives } =
    require("../verifyMemoNarratives") as typeof import("../verifyMemoNarratives");

  const subject = memo();
  const narratives = Object.fromEntries(
    [
      "executive_summary", "income_analysis", "repayment_analysis",
      "property_description", "borrower_background", "borrower_experience",
      "guarantor_strength",
    ].map((key) => [key, `Total liabilities stand at $830,000. (${key})`]),
  ) as any;

  await verifyMemoNarratives({
    dealId: "deal-1",
    bankId: "bank-1",
    memo: subject,
    narratives,
    sb: { from: () => ({}) } as any,
  });

  assert.deepEqual(capturedFacts, buildNarrativeInput(subject));
});
