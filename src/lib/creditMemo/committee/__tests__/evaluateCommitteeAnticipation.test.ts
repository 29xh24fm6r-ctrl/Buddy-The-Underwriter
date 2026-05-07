/**
 * Committee Anticipation Engine — pure orchestrator tests.
 *
 * Verifies posture grading, ranking, positioning, and headline behavior
 * across the canonical states a banker hits.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { evaluateCommitteeAnticipation } from "@/lib/creditMemo/committee/evaluateCommitteeAnticipation";
import type { CommitteeEngineInputs } from "@/lib/creditMemo/committee/types";

const DEAL = "deal-test";
const NOW = new Date("2026-05-06T12:00:00Z");

function inputs(over: Partial<CommitteeEngineInputs> = {}): CommitteeEngineInputs {
  return {
    dealId: DEAL,
    metrics: {
      dscr: 1.6,
      dscr_stressed_300bps: 1.3,
      cash_flow_available: 500_000,
      annual_debt_service: 250_000,
      excess_cash_flow: 250_000,
      global_cash_flow: 600_000,
      gcf_dscr: 1.7,
      revenue_ttm: 5_000_000,
      ebitda_ttm: 1_000_000,
      net_income_ttm: 500_000,
      debt_to_equity: 1.5,
      total_liabilities: 2_000_000,
      net_worth: 2_000_000,
      collateral_gross_value: 3_000_000,
      collateral_discounted_value: 2_500_000,
      collateral_coverage: 1.6,
      ltv_gross: 0.6,
      ltv_net: 0.55,
      loan_amount: 1_500_000,
      bank_loan_total: 1_500_000,
      pfs_total_assets: 800_000,
      pfs_net_worth: 600_000,
    },
    memoInput: {
      ready: true,
      blockerCodes: [],
      openConflictsCount: 0,
      borrowerStoryCustomers: "Diversified base of 200+ small commercial accounts",
      borrowerStoryConcentration: "No single customer above 10% of revenue",
      borrowerStoryRevenueModel: "Recurring subscription billing model",
      borrowerStoryRisks: "Modest seasonality in Q4",
      managementProfilesCount: 2,
      collateralItemsCount: 2,
      collateralWithValueCount: 2,
    },
    research: {
      gate_passed: true,
      trust_grade: "committee_grade",
      quality_score: 0.85,
      industry: "Industrial services",
    },
    pricing: { decided: true, rate_initial_pct: 8.5 },
    openPolicyExceptionsCount: 0,
    covenantPackagePresent: true,
    now: NOW,
    ...over,
  };
}

// ─── Posture grading ────────────────────────────────────────────────────────

test("[committee-1] clean deal → committee_ready posture", () => {
  const r = evaluateCommitteeAnticipation(inputs());
  assert.equal(r.posture, "committee_ready");
  assert.equal(r.headline, "This deal is committee-ready.");
  assert.equal(r.objections.filter((o) => o.severity === "hard").length, 0);
});

test("[committee-2] DSCR < 1.25x → workable_with_mitigants + hard objection", () => {
  const r = evaluateCommitteeAnticipation(
    inputs({ metrics: { ...inputs().metrics, dscr: 1.1, dscr_stressed_300bps: 1.05 } }),
  );
  assert.equal(r.posture, "workable_with_mitigants");
  const hard = r.objections.find((o) => o.severity === "hard");
  assert.ok(hard, "must surface a hard objection");
  assert.match(hard!.label, /DSCR/);
  assert.match(r.headline, /Workable with mitigants/);
});

test("[committee-3] 3+ hard objections → hard_sell", () => {
  const r = evaluateCommitteeAnticipation(
    inputs({
      metrics: {
        ...inputs().metrics,
        dscr: 1.1, // hard
        dscr_stressed_300bps: 0.9, // hard
        ltv_gross: 0.95, // hard
      },
    }),
  );
  assert.equal(r.posture, "hard_sell");
  assert.match(r.headline, /Hard sell/);
});

test("[committee-4] memo inputs not ready → not_ready posture", () => {
  const r = evaluateCommitteeAnticipation(
    inputs({
      memoInput: {
        ...inputs().memoInput,
        ready: false,
        blockerCodes: ["missing_business_description"],
      },
    }),
  );
  assert.equal(r.posture, "not_ready");
  assert.match(r.headline, /Not ready for committee/);
  assert.ok(r.doc_weaknesses.length >= 1);
});

// ─── Confidence score ───────────────────────────────────────────────────────

test("[committee-5] confidence score is 100 for a clean deal", () => {
  const r = evaluateCommitteeAnticipation(inputs());
  assert.equal(r.confidence_score, 100);
});

test("[committee-6] confidence score deducts for hard + soft objections", () => {
  const r = evaluateCommitteeAnticipation(
    inputs({ metrics: { ...inputs().metrics, dscr: 1.1, dscr_stressed_300bps: 0.95 } }),
  );
  assert.ok(r.confidence_score < 100);
  assert.ok(r.confidence_score >= 0);
});

// ─── Ranking ────────────────────────────────────────────────────────────────

test("[committee-7] hard objections rank before soft", () => {
  const r = evaluateCommitteeAnticipation(
    inputs({
      metrics: {
        ...inputs().metrics,
        dscr: 1.1, // hard
        ltv_gross: 0.78, // soft
      },
    }),
  );
  // First objection should be hard.
  assert.equal(r.objections[0].severity, "hard");
  // The soft LTV objection should come after.
  const ltvIdx = r.objections.findIndex((o) => o.code.startsWith("collateral_ltv"));
  const dscrIdx = r.objections.findIndex((o) => o.code === "repayment_dscr_below_hard_threshold");
  assert.ok(dscrIdx < ltvIdx, "hard DSCR must rank above soft LTV");
});

// ─── Positioning ─────────────────────────────────────────────────────────────

test("[committee-8] strong DSCR + recurring revenue → recurring-revenue lead-with line", () => {
  const r = evaluateCommitteeAnticipation(inputs());
  const recurringLine = r.positioning.lead_with.find((l) => /recurring/i.test(l));
  assert.ok(recurringLine, "must mention recurring revenue when revenue model contains it");
});

test("[committee-9] strong DSCR → DSCR lead-with line", () => {
  const r = evaluateCommitteeAnticipation(inputs());
  const dscrLine = r.positioning.lead_with.find((l) => /DSCR|coverage/i.test(l));
  assert.ok(dscrLine);
});

test("[committee-10] each hard objection produces a prepare-for line", () => {
  const r = evaluateCommitteeAnticipation(
    inputs({
      metrics: { ...inputs().metrics, dscr: 1.1, dscr_stressed_300bps: 0.95 },
    }),
  );
  // At least one prepare-for entry referencing the dscr concern.
  assert.ok(r.positioning.prepare_for.some((l) => /DSCR/.test(l)));
});

test("[committee-11] frame is set for leverage-dominant deals", () => {
  const r = evaluateCommitteeAnticipation(
    inputs({
      metrics: {
        ...inputs().metrics,
        total_liabilities: 5_000_000,
        ebitda_ttm: 1_000_000, // 5x debt/EBITDA — hard leverage
      },
    }),
  );
  assert.ok(r.positioning.frame);
  assert.match(r.positioning.frame!, /leverage|deleveraging/i);
});

// ─── Domain coverage ────────────────────────────────────────────────────────

test("[committee-12] high LTV produces collateral hard objection", () => {
  const r = evaluateCommitteeAnticipation(
    inputs({ metrics: { ...inputs().metrics, ltv_gross: 0.92 } }),
  );
  const o = r.objections.find((x) => x.code === "collateral_ltv_high");
  assert.ok(o);
  assert.equal(o!.severity, "hard");
});

test("[committee-13] negative excess cash flow → hard repayment objection", () => {
  const r = evaluateCommitteeAnticipation(
    inputs({
      metrics: { ...inputs().metrics, excess_cash_flow: -50_000 },
    }),
  );
  const o = r.objections.find((x) => x.code === "repayment_excess_cash_flow_negative");
  assert.ok(o);
  assert.equal(o!.severity, "hard");
});

test("[committee-14] negative PFS net worth → hard liquidity objection", () => {
  const r = evaluateCommitteeAnticipation(
    inputs({
      metrics: { ...inputs().metrics, pfs_net_worth: -50_000 },
    }),
  );
  const o = r.objections.find((x) => x.code === "liquidity_pfs_net_worth_negative");
  assert.ok(o);
  assert.equal(o!.severity, "hard");
});

test("[committee-15] open policy exceptions → hard policy objection", () => {
  const r = evaluateCommitteeAnticipation(inputs({ openPolicyExceptionsCount: 2 }));
  const o = r.objections.find((x) => x.code === "policy_open_exceptions");
  assert.ok(o);
  assert.match(o!.label, /2 open policy exception/);
});

test("[committee-16] no covenant package → soft structural objection", () => {
  const r = evaluateCommitteeAnticipation(inputs({ covenantPackagePresent: false }));
  const o = r.objections.find((x) => x.code === "structural_no_covenant_package");
  assert.ok(o);
  assert.equal(o!.severity, "soft");
});

test("[committee-17] no management profile → hard guarantor objection", () => {
  const r = evaluateCommitteeAnticipation(
    inputs({
      memoInput: { ...inputs().memoInput, managementProfilesCount: 0 },
    }),
  );
  const o = r.objections.find((x) => x.code === "structural_no_guarantor_documented");
  assert.ok(o);
  assert.equal(o!.severity, "hard");
});

test("[committee-18] high customer concentration in story → hard concentration objection", () => {
  const r = evaluateCommitteeAnticipation(
    inputs({
      memoInput: {
        ...inputs().memoInput,
        borrowerStoryConcentration: "Single customer accounts for 80% of revenue",
      },
    }),
  );
  const o = r.objections.find((x) => x.code === "concentration_customer_high");
  assert.ok(o);
});

test("[committee-19] industry rule fires for restaurant industry", () => {
  const r = evaluateCommitteeAnticipation(
    inputs({
      research: {
        gate_passed: true,
        trust_grade: "committee_grade",
        quality_score: 0.85,
        industry: "Quick service restaurant",
      },
    }),
  );
  const o = r.objections.find((x) => x.code === "industry_restaurant_volatility");
  assert.ok(o);
});

// ─── Determinism ────────────────────────────────────────────────────────────

test("[committee-20] same inputs → identical output (pure function)", () => {
  const a = evaluateCommitteeAnticipation(inputs());
  const b = evaluateCommitteeAnticipation(inputs());
  assert.deepEqual(a, b);
});

// ─── Headline + follow-ups ──────────────────────────────────────────────────

test("[committee-21] follow-ups list each hard objection as a question", () => {
  const r = evaluateCommitteeAnticipation(
    inputs({
      metrics: { ...inputs().metrics, dscr: 1.1, dscr_stressed_300bps: 0.95 },
    }),
  );
  assert.ok(r.follow_ups.length >= 1);
  assert.ok(r.follow_ups.some((q) => /DSCR/i.test(q)));
});
