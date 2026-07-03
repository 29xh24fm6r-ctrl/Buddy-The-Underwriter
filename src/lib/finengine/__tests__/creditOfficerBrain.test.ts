/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 15 tests.
 *
 * ≥12 concern types fire; concerns are ranked and cite supporting metrics.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { runCreditOfficerReview, detectConcerns, type OfficerInput } from "@/lib/finengine/officer";

// A deliberately troubled credit that triggers every detector.
const troubled: OfficerInput = {
  revenueSeries: [10_000_000, 8_500_000], // decline
  ebitdaMarginSeries: [0.18, 0.12], // compression
  workingCapitalSeries: [500_000, -100_000], // weakening
  totalDebtSeries: [2_000_000, 3_000_000], // rising
  dscr: 1.05,
  dscrPriorYear: 1.4, // compression + weak
  currentRatio: 0.9,
  currentRatioPrior: 1.4, // declining + <1
  arDays: 95, // stale
  ownerDistributions: 400_000,
  netIncome: 200_000, // distributions > earnings
  taxVsStatementVariancePct: 0.3, // inconsistent
  aggressiveAddbacks: true, // excessive addbacks
  collateralCoverage: 0.6, // shortfall
  industryKeyRisks: ["reimbursement_rate_cuts"], // industry
};

describe("PR15 — concern coverage (≥12 types)", () => {
  const concerns = detectConcerns(troubled);
  const codes = new Set(concerns.map((c) => c.code.split(":")[0]));

  it("fires at least 12 distinct concern types", () => {
    assert.ok(codes.size >= 12, `only ${codes.size} concern types: ${[...codes].join(", ")}`);
  });

  const expected = [
    "revenue_decline",
    "margin_compression",
    "weakening_working_capital",
    "rising_debt",
    "dscr_compression",
    "weak_dscr",
    "declining_liquidity",
    "stale_ar",
    "distributions_exceed_earnings",
    "inconsistent_tax_statements",
    "excessive_addbacks",
    "collateral_shortfall",
    "industry_risk",
  ];
  for (const code of expected) {
    it(`detects ${code}`, () => {
      assert.ok(concerns.some((c) => c.code.startsWith(code)), code);
    });
  }
});

describe("PR15 — ranking + evidence citation", () => {
  it("ranks most-urgent first; top concern is repayment/liquidity/collateral", () => {
    const r = runCreditOfficerReview(troubled);
    assert.ok(r.concerns.length >= 12);
    // Sorted descending by rank.
    for (let i = 1; i < r.concerns.length; i++) assert.ok(r.concerns[i - 1].rank >= r.concerns[i].rank);
    assert.ok(["repayment", "liquidity", "collateral"].includes(r.topConcern!.category));
  });

  it("every concern cites supporting metrics and a mitigant", () => {
    for (const c of detectConcerns(troubled)) {
      assert.ok(Object.keys(c.supportingMetrics).length > 0, c.code);
      assert.ok(c.recommendedMitigant.length > 0, c.code);
    }
  });

  it("clean credit yields no concerns", () => {
    const r = runCreditOfficerReview({
      revenueSeries: [1_000_000, 1_200_000],
      dscr: 1.6,
      dscrPriorYear: 1.5,
      currentRatio: 2.0,
      currentRatioPrior: 1.8,
      arDays: 35,
      collateralCoverage: 1.4,
    });
    assert.equal(r.concerns.length, 0);
    assert.equal(r.topConcern, null);
  });
});
