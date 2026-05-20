import test from "node:test";
import assert from "node:assert/strict";

import { buildFloridaArmorySnapshot } from "@/lib/creditMemo/snapshot/buildFloridaArmorySnapshot";
import {
  FloridaArmoryBuildError,
  FLORIDA_ARMORY_SECTION_KEYS,
} from "@/lib/creditMemo/snapshot/types";

const READY_CONTRACT = {
  passed: true,
  required: {},
  warnings: {},
  blockers: [],
  warningList: [],
  evaluatedAt: "2026-05-05T12:00:00.000Z",
  contractVersion: "memo_readiness_v1",
} as any;

function baseMemo(extra: Record<string, unknown> = {}) {
  return {
    deal_id: "deal-fa-1",
    bank_id: "bank-fa-1",
    version: "canonical_v1",
    generated_at: "2026-05-05T00:00:00.000Z",
    header: { borrower_name: "Test Borrower LLC" },
    key_metrics: {
      loan_amount: { value: 1000000, source: "Snapshot", updated_at: null },
      dscr_uw: { value: 1.4, source: "Snapshot", updated_at: null },
      ltv_gross: { value: 0.65, source: "Snapshot", updated_at: null },
      product: "CRE_TERM",
    },
    sources_uses: { rows: [] },
    eligibility: { naics_code: "722513" },
    collateral: {
      property_description: "Restaurant",
      line_items: [],
      gross_value: { value: 1500000, source: "Snapshot", updated_at: null },
      net_value: { value: 1400000, source: "Snapshot", updated_at: null },
      discounted_value: { value: 1300000, source: "Snapshot", updated_at: null },
    },
    business_summary: { business_description: "Restaurant operator" },
    business_industry_analysis: null,
    management_qualifications: { principals: [{ id: "p1", name: "Jane Smith", bio: "Industry veteran" }] },
    financial_analysis: {
      income_analysis: "Revenue trended up.",
      dscr: { value: 1.4, source: "Snapshot", updated_at: null },
      dscr_stressed: { value: 1.2, source: "Snapshot", updated_at: null },
      revenue: { value: 2500000, source: "Snapshot", updated_at: null },
      ebitda: { value: 320000, source: "Snapshot", updated_at: null },
      net_income: { value: 180000, source: "Snapshot", updated_at: null },
      cash_flow_available: { value: 250000, source: "Snapshot", updated_at: null },
      debt_service: { value: 107964, source: "Snapshot", updated_at: null },
      debt_coverage_table: [],
      income_statement_table: [],
      breakeven: { narrative: "Revenue cushion supports repayment." },
    },
    global_cash_flow: {
      global_cash_flow: { value: 250000, source: "Snapshot", updated_at: null },
      global_dscr: { value: 1.5, source: "Snapshot", updated_at: null },
      global_cf_table: [],
    },
    personal_financial_statements: [],
    executive_summary: { narrative: "Strong operator." },
    transaction_overview: { loan_request: { purpose: "Purchase property" } },
    risk_factors: [],
    strengths_weaknesses: { strengths: [], weaknesses: [] },
    policy_exceptions: [],
    proposed_terms: { product: "CRE_TERM" },
    conditions: { precedent: [], ongoing: [], insurance: [] },
    recommendation: { verdict: "approve", exceptions: [], rationale: "Repayment capacity is supported." },
    stress_testing: null,
    covenant_package: null,
    qualitative_assessment: null,
    meta: { spreads: [], readiness: { status: "ready" } },
    ...extra,
  } as any;
}

function buildSnapshot(memo = baseMemo()) {
  return buildFloridaArmorySnapshot({
    dealId: "deal-fa-1",
    bankId: "bank-fa-1",
    bankerId: "user_test_banker",
    memoVersion: 1,
    inputHash: "0".repeat(64),
    canonicalMemo: memo,
    readinessContract: READY_CONTRACT,
    overrides: {},
    submittedAt: "2026-05-05T12:00:00.000Z",
    snapshotId: "11111111-1111-1111-1111-111111111111",
  });
}

test("buildFloridaArmorySnapshot populates the full Florida Armory section set", () => {
  const snap = buildSnapshot();
  assert.equal(snap.schema_version, "florida_armory_v1");
  assert.equal(Object.keys(snap.sections).length, FLORIDA_ARMORY_SECTION_KEYS.length);
  for (const key of FLORIDA_ARMORY_SECTION_KEYS) {
    assert.ok(snap.sections[key], `missing section ${key}`);
  }
});

test("buildFloridaArmorySnapshot blocks failed readiness contracts", () => {
  const failed = {
    ...READY_CONTRACT,
    passed: false,
    blockers: [{ code: "dscr_computed", label: "DSCR not computed", owner: "buddy" }],
  } as any;
  assert.throws(() => buildFloridaArmorySnapshot({
    dealId: "deal-fa-1",
    bankId: "bank-fa-1",
    bankerId: "user_test_banker",
    memoVersion: 1,
    inputHash: "0".repeat(64),
    canonicalMemo: baseMemo(),
    readinessContract: failed,
    overrides: {},
  }), FloridaArmoryBuildError);
});

test("institutional gate blocks unresolved committee text", () => {
  assert.throws(() => buildSnapshot(baseMemo({
    recommendation: { verdict: "approve", rationale: "Conclusion is not final." },
  })), FloridaArmoryBuildError);
});

test("institutional gate blocks DSCR contradiction", () => {
  assert.throws(() => buildSnapshot(baseMemo({
    recommendation: { verdict: "approve", rationale: "DSCR could not be calculated." },
  })), FloridaArmoryBuildError);
});

test("institutional gate blocks AR line memos without an AR borrowing base", () => {
  assert.throws(() => buildSnapshot(baseMemo({
    proposed_terms: { product: "LOC_SECURED" },
    collateral: { property_description: "accounts receivable working capital facility", line_items: [] },
  })), FloridaArmoryBuildError);
});
