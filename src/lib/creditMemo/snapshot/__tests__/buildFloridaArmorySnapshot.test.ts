/**
 * Florida Armory Snapshot Builder Guards (20-section shape).
 *
 * Invariants enforced:
 *   1. Failed readiness contract throws FloridaArmoryBuildError
 *   2. All 20 Florida Armory section keys are populated
 *   3. Each section has the expected primitive shape
 *   4. Determinism: identical inputs produce identical snapshots
 *   5. Banker ownership recorded in BOTH meta and banker_submission
 *   6. input_hash flows through unchanged
 *   7. snapshot_id is optional but round-trips when supplied
 *   8. schema_version is locked at "florida_armory_v1"
 *   9. Diagnostics carries readiness_contract and source coverage
 *  10. canonical_memo is embedded for self-containment
 *  11. Sources include the system canonical-builder source
 *  12. Memo version flows through to meta
 */

import test from "node:test";
import assert from "node:assert/strict";

import { buildFloridaArmorySnapshot } from "@/lib/creditMemo/snapshot/buildFloridaArmorySnapshot";
import {
  FloridaArmoryBuildError,
  FLORIDA_ARMORY_SECTION_KEYS,
} from "@/lib/creditMemo/snapshot/types";
import { evaluateMemoReadinessContract } from "@/lib/creditMemo/submission/evaluateMemoReadinessContract";
import { computeInputHash } from "@/lib/creditMemo/submission/computeInputHash";
import type { CanonicalCreditMemoV1 } from "@/lib/creditMemo/canonical/types";
import type { MemoReadinessContract } from "@/lib/creditMemo/submission/types";

// ─── Fixtures ───────────────────────────────────────────────────────────────

function buildMemoFixture(opts: {
  dscr?: number | null;
  loanAmount?: number | null;
  collateralGross?: number | null;
} = {}): CanonicalCreditMemoV1 {
  const m = {
    deal_id: "deal-fa-1",
    bank_id: "bank-fa-1",
    version: "canonical_v1",
    generated_at: "2026-05-05T00:00:00.000Z",
    header: { borrower_name: "Test Borrower LLC" },
    key_metrics: {
      loan_amount: { value: "loanAmount" in opts ? opts.loanAmount : 1_000_000, source: "Snapshot:loan_amount", updated_at: null },
      dscr_uw: { value: 1.4, source: "Snapshot", updated_at: null },
      ltv_gross: { value: 0.65, source: "Snapshot", updated_at: null },
    },
    sources_uses: { sources: [], uses: [], total_project_cost: { value: null, source: "", updated_at: null }, borrower_equity: { value: null, source: "", updated_at: null } },
    eligibility: { naics_code: "722513" },
    collateral: {
      property_description: "Restaurant",
      line_items: [],
      gross_value: { value: "collateralGross" in opts ? opts.collateralGross : 1_500_000, source: "Snapshot:gross", updated_at: null },
      ltv_gross: { value: 0.65, source: "Snapshot", updated_at: null },
      net_value: { value: 1_400_000, source: "Snapshot", updated_at: null },
      discounted_value: { value: 1_300_000, source: "Snapshot", updated_at: null },
      ltv_net: { value: 0.7, source: "Snapshot", updated_at: null },
      discounted_coverage: { value: 1.1, source: "Snapshot", updated_at: null },
      collateral_coverage: { value: 1.5, source: "Snapshot", updated_at: null },
    },
    business_summary: { business_description: "Restaurant operator" },
    business_industry_analysis: null,
    management_qualifications: { principals: [{ id: "p1", name: "Jane Smith", bio: "Industry veteran" }] },
    financial_analysis: {
      income_analysis: "Revenue trended up.",
      dscr: { value: "dscr" in opts ? opts.dscr : 1.4, source: "Snapshot:dscr", updated_at: null },
      dscr_stressed: { value: 1.2, source: "Snapshot", updated_at: null },
      revenue: { value: 2_500_000, source: "Snapshot", updated_at: null },
      ebitda: { value: 320_000, source: "Snapshot", updated_at: null },
      net_income: { value: 180_000, source: "Snapshot", updated_at: null },
      cash_flow_available: { value: 250_000, source: "Snapshot", updated_at: null },
      debt_service: { value: 107_964, source: "Snapshot", updated_at: null },
      excess_cash_flow: { value: 142_036, source: "Snapshot", updated_at: null },
      debt_yield: { value: 0.12, source: "Snapshot", updated_at: null },
      working_capital: { value: 90_000, source: "Snapshot", updated_at: null },
      debt_coverage_table: [],
      income_statement_table: [],
      ratio_analysis: [],
      breakeven: { narrative: "" },
    },
    global_cash_flow: {
      global_cash_flow: { value: 250_000, source: "Snapshot", updated_at: null },
      global_dscr: { value: 1.5, source: "Snapshot", updated_at: null },
      global_cf_table: [],
    },
    personal_financial_statements: [],
    executive_summary: { narrative: "Strong operator." },
    transaction_overview: { loan_request: { purpose: "Purchase property" } },
    borrower_sponsor: { background: "Founded 2018", experience: "15 years", guarantor_strength: "OK", sponsors: [] },
    risk_factors: [],
    strengths_weaknesses: { strengths: [], weaknesses: [] },
    policy_exceptions: [],
    proposed_terms: { product: "CRE_TERM" },
    conditions: { precedent: [], ongoing: [], insurance: [] },
    recommendation: { verdict: "approve", exceptions: [] },
    stress_testing: null,
    covenant_package: null,
    qualitative_assessment: null,
    meta: { spreads: [], readiness: { status: "ready" } },
  };
  return m as unknown as CanonicalCreditMemoV1;
}

const PASSING_OVERRIDES = {
  business_description: "Restaurant in suburban neighborhood, 8 years.",
  principal_bio_p1: "Jane Smith — 15 years experience, clean credit.",
  tabs_viewed: ["covenants", "qualitative"],
};

function buildPassingReadiness(memo: CanonicalCreditMemoV1): MemoReadinessContract {
  return evaluateMemoReadinessContract({
    memo,
    overrides: PASSING_OVERRIDES,
    now: new Date("2026-05-05T12:00:00.000Z"),
  });
}

const FIXED_HASH = "0".repeat(64);
const FIXED_BANKER_ID = "user_test_banker";
const FIXED_DEAL_ID = "deal-fa-1";
const FIXED_BANK_ID = "bank-fa-1";
const FIXED_SUBMITTED_AT = "2026-05-05T12:00:00.000Z";
const FIXED_SNAPSHOT_ID = "11111111-1111-1111-1111-111111111111";

function buildArgs(over: Partial<Parameters<typeof buildFloridaArmorySnapshot>[0]> = {}) {
  const memo = buildMemoFixture();
  const readiness = buildPassingReadiness(memo);
  return {
    dealId: FIXED_DEAL_ID,
    bankId: FIXED_BANK_ID,
    bankerId: FIXED_BANKER_ID,
    memoVersion: 1,
    inputHash: FIXED_HASH,
    canonicalMemo: memo,
    readinessContract: readiness,
    overrides: PASSING_OVERRIDES,
    submittedAt: FIXED_SUBMITTED_AT,
    snapshotId: FIXED_SNAPSHOT_ID,
    ...over,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Guard 1: Readiness blockers throw
// ═══════════════════════════════════════════════════════════════════════════

test("[fa-1] failed readiness contract throws FloridaArmoryBuildError", () => {
  const memo = buildMemoFixture();
  const failed: MemoReadinessContract = {
    passed: false,
    required: { dscr_computed: false, loan_amount: true, collateral_value: true, business_description: true, management_bio: true },
    warnings: { ai_narrative_missing: false, research_missing: false, covenant_review_missing: false, qualitative_review_missing: false },
    blockers: [{ code: "dscr_computed", label: "DSCR not computed", owner: "buddy" }],
    warningList: [],
    evaluatedAt: FIXED_SUBMITTED_AT,
    contractVersion: "memo_readiness_v1",
  };
  assert.throws(
    () => buildFloridaArmorySnapshot(buildArgs({ canonicalMemo: memo, readinessContract: failed })),
    (err: unknown) => {
      assert.ok(err instanceof FloridaArmoryBuildError);
      assert.equal((err as FloridaArmoryBuildError).code, "readiness_failed");
      assert.deepEqual((err as FloridaArmoryBuildError).missingFields, ["dscr_computed"]);
      return true;
    },
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// Guard 2: All 20 sections populated
// ═══════════════════════════════════════════════════════════════════════════

test("[fa-2] all 20 Florida Armory section keys are populated", () => {
  const snap = buildFloridaArmorySnapshot(buildArgs());
  for (const key of FLORIDA_ARMORY_SECTION_KEYS) {
    const section = snap.sections[key];
    assert.ok(section, `section ${key} must be present`);
    assert.equal(section.key, key);
    assert.equal(typeof section.title, "string");
    assert.equal(typeof section.narrative, "string");
    assert.ok(typeof section.data === "object");
    assert.ok(Array.isArray(section.tables));
    assert.ok(Array.isArray(section.citations));
    assert.ok(Array.isArray(section.warnings));
  }
  assert.equal(Object.keys(snap.sections).length, FLORIDA_ARMORY_SECTION_KEYS.length);
  assert.equal(FLORIDA_ARMORY_SECTION_KEYS.length, 20);
});

// ═══════════════════════════════════════════════════════════════════════════
// Guard 3: Required readiness section is always populated, even with empty data
// ═══════════════════════════════════════════════════════════════════════════

test("[fa-3] readiness section carries the readiness payload", () => {
  const snap = buildFloridaArmorySnapshot(buildArgs());
  assert.ok("readiness" in snap.sections.readiness.data);
});

// ═══════════════════════════════════════════════════════════════════════════
// Guard 4: Determinism — same inputs produce identical snapshot
// ═══════════════════════════════════════════════════════════════════════════

test("[fa-4] same inputs produce identical snapshots", () => {
  const args = buildArgs();
  const a = buildFloridaArmorySnapshot(args);
  const b = buildFloridaArmorySnapshot(args);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

// ═══════════════════════════════════════════════════════════════════════════
// Guard 5: Banker ownership recorded in two places
// ═══════════════════════════════════════════════════════════════════════════

test("[fa-5] meta.submitted_by AND banker_submission.submitted_by both equal banker id", () => {
  const snap = buildFloridaArmorySnapshot(buildArgs());
  assert.equal(snap.meta.submitted_by, FIXED_BANKER_ID);
  assert.equal(snap.banker_submission.submitted_by, FIXED_BANKER_ID);
  assert.equal(snap.banker_submission.certification, true);
  assert.equal(snap.meta.generated_by, "buddy");
  assert.equal(snap.meta.submission_role, "banker");
});

// ═══════════════════════════════════════════════════════════════════════════
// Guard 6: input_hash flow-through
// ═══════════════════════════════════════════════════════════════════════════

test("[fa-6] input_hash flows through unchanged from gate to snapshot", () => {
  const memo = buildMemoFixture();
  const readiness = buildPassingReadiness(memo);
  const computed = computeInputHash({
    memo,
    overrides: PASSING_OVERRIDES,
    bankerId: FIXED_BANKER_ID,
  });
  const snap = buildFloridaArmorySnapshot(buildArgs({
    canonicalMemo: memo,
    readinessContract: readiness,
    inputHash: computed,
  }));
  assert.equal(snap.meta.input_hash, computed);
  assert.match(snap.meta.input_hash, /^[0-9a-f]{64}$/);
});

// ═══════════════════════════════════════════════════════════════════════════
// Guard 7: snapshot_id round-trip
// ═══════════════════════════════════════════════════════════════════════════

test("[fa-7] snapshot_id round-trips when supplied", () => {
  const id = "abcd1234-5678-9012-3456-7890abcdef00";
  const snap = buildFloridaArmorySnapshot(buildArgs({ snapshotId: id }));
  assert.equal(snap.meta.snapshot_id, id);
});

// ═══════════════════════════════════════════════════════════════════════════
// Guard 8: schema_version locked
// ═══════════════════════════════════════════════════════════════════════════

test("[fa-8] schema_version is florida_armory_v1", () => {
  const snap = buildFloridaArmorySnapshot(buildArgs());
  assert.equal(snap.schema_version, "florida_armory_v1");
  assert.equal(snap.meta.render_mode, "committee");
});

// ═══════════════════════════════════════════════════════════════════════════
// Guard 9: Diagnostics
// ═══════════════════════════════════════════════════════════════════════════

test("[fa-9] diagnostics carries readiness_contract and source_coverage", () => {
  const snap = buildFloridaArmorySnapshot(buildArgs());
  assert.equal(snap.diagnostics.readiness_contract.contractVersion, "memo_readiness_v1");
  assert.equal(snap.diagnostics.readiness_contract.passed, true);
  assert.equal(typeof snap.diagnostics.source_coverage.document_sources, "number");
  assert.equal(typeof snap.diagnostics.source_coverage.financial_fact_sources, "number");
  assert.ok(Array.isArray(snap.diagnostics.warnings));
});

// ═══════════════════════════════════════════════════════════════════════════
// Guard 10: canonical_memo embedded for self-containment
// ═══════════════════════════════════════════════════════════════════════════

test("[fa-10] canonical_memo embedded — snapshot is self-contained", () => {
  const snap = buildFloridaArmorySnapshot(buildArgs());
  assert.ok(snap.canonical_memo);
  assert.equal(snap.canonical_memo.deal_id, FIXED_DEAL_ID);
  assert.equal(snap.canonical_memo.bank_id, FIXED_BANK_ID);
});

// ═══════════════════════════════════════════════════════════════════════════
// Guard 11: Sources include canonical builder system source
// ═══════════════════════════════════════════════════════════════════════════

test("[fa-11] sources include the canonical builder system source", () => {
  const snap = buildFloridaArmorySnapshot(buildArgs());
  const system = snap.sources.find((s) => s.source_type === "system");
  assert.ok(system, "system source must be in sources[]");
  assert.equal(system!.label, "Canonical credit memo builder");
  assert.ok(system!.section_keys.length >= FLORIDA_ARMORY_SECTION_KEYS.length);
});

// ═══════════════════════════════════════════════════════════════════════════
// Guard 12: Memo version flows through
// ═══════════════════════════════════════════════════════════════════════════

test("[fa-12] memo_version flows through to meta", () => {
  const snap = buildFloridaArmorySnapshot(buildArgs({ memoVersion: 7 }));
  assert.equal(snap.meta.memo_version, 7);
});

// ═══════════════════════════════════════════════════════════════════════════
// Guard 13: submitted_at is consistent across meta and banker_submission
// ═══════════════════════════════════════════════════════════════════════════

test("[fa-13] submitted_at consistent across meta and banker_submission", () => {
  const snap = buildFloridaArmorySnapshot(buildArgs());
  assert.equal(snap.meta.submitted_at, FIXED_SUBMITTED_AT);
  assert.equal(snap.banker_submission.submitted_at, FIXED_SUBMITTED_AT);
  assert.equal(snap.meta.generated_at, FIXED_SUBMITTED_AT);
});
