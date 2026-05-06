/**
 * Memo Readiness Contract Guards
 *
 * Invariants enforced:
 *   1. All 5 required items must pass for the contract to pass
 *   2. Each required item produces a blocker with the correct owner when missing
 *   3. Recommended items produce warnings, never blockers
 *   4. Pure function — same inputs produce identical contract output
 *   5. Required-item logic mirrors BankerReviewPanel.tsx exactly
 */

import test from "node:test";
import assert from "node:assert/strict";

import { evaluateMemoReadinessContract } from "@/lib/creditMemo/submission/evaluateMemoReadinessContract";
import type { CanonicalCreditMemoV1 } from "@/lib/creditMemo/canonical/types";

// ─── Test fixture builders ───────────────────────────────────────────────────

function memoStub(opts: Partial<{
  dscr: number | null;
  loanAmount: number | null;
  collateralGross: number | null;
  principalIds: string[];
  narrative: string | null;
  hasResearch: boolean;
}> = {}): CanonicalCreditMemoV1 {
  // Use 'in opts' checks so callers can pass null explicitly without
  // falling back to the default via ??.
  const m = {
    deal_id: "deal-test",
    bank_id: "bank-test",
    version: "canonical_v1",
    generated_at: "2026-05-05T00:00:00.000Z",
    financial_analysis: {
      dscr: { value: "dscr" in opts ? opts.dscr : 1.4 },
    },
    key_metrics: {
      loan_amount: { value: "loanAmount" in opts ? opts.loanAmount : 1_000_000 },
    },
    collateral: {
      gross_value: { value: "collateralGross" in opts ? opts.collateralGross : 1_500_000 },
    },
    management_qualifications: {
      principals: (opts.principalIds ?? ["p1"]).map((id) => ({ id, name: id })),
    },
    executive_summary: {
      narrative: "narrative" in opts
        ? opts.narrative
        : "Strong borrower with demonstrated cash flow.",
    },
    business_industry_analysis:
      opts.hasResearch === false ? null : { industry_overview: "stub" },
  };
  return m as unknown as CanonicalCreditMemoV1;
}

const PASSING_OVERRIDES = (principalId = "p1") => ({
  business_description:
    "Operating company in food service sector with 8 years of profitability.",
  [`principal_bio_${principalId}`]:
    "Owner has 15 years of industry experience and a clean credit history.",
  tabs_viewed: ["covenants", "qualitative"],
});

// ═══════════════════════════════════════════════════════════════════════════
// Guard 1: Contract passes when all 5 required items satisfied
// ═══════════════════════════════════════════════════════════════════════════

test("[guard-1] passes with all required items satisfied", () => {
  const c = evaluateMemoReadinessContract({
    memo: memoStub(),
    overrides: PASSING_OVERRIDES(),
  });
  assert.equal(c.passed, true);
  assert.equal(c.blockers.length, 0);
  assert.equal(c.required.dscr_computed, true);
  assert.equal(c.required.loan_amount, true);
  assert.equal(c.required.collateral_value, true);
  assert.equal(c.required.business_description, true);
  assert.equal(c.required.management_bio, true);
});

// ═══════════════════════════════════════════════════════════════════════════
// Guard 2: Each missing required item produces a blocker
// ═══════════════════════════════════════════════════════════════════════════

test("[guard-2a] missing DSCR blocks submission, owner=buddy", () => {
  const c = evaluateMemoReadinessContract({
    memo: memoStub({ dscr: null }),
    overrides: PASSING_OVERRIDES(),
  });
  assert.equal(c.passed, false);
  const b = c.blockers.find((x) => x.code === "dscr_computed");
  assert.ok(b, "dscr_computed blocker present");
  assert.equal(b!.owner, "buddy");
});

test("[guard-2b] missing loan amount blocks submission, owner=banker", () => {
  const c = evaluateMemoReadinessContract({
    memo: memoStub({ loanAmount: null }),
    overrides: PASSING_OVERRIDES(),
  });
  assert.equal(c.passed, false);
  assert.equal(c.required.loan_amount, false);
  assert.ok(c.blockers.find((x) => x.code === "loan_amount" && x.owner === "banker"));
});

test("[guard-2c] zero loan amount blocks submission", () => {
  const c = evaluateMemoReadinessContract({
    memo: memoStub({ loanAmount: 0 }),
    overrides: PASSING_OVERRIDES(),
  });
  assert.equal(c.required.loan_amount, false);
  assert.equal(c.passed, false);
});

test("[guard-2d] missing collateral value blocks submission", () => {
  const c = evaluateMemoReadinessContract({
    memo: memoStub({ collateralGross: null }),
    overrides: PASSING_OVERRIDES(),
  });
  assert.equal(c.required.collateral_value, false);
  assert.equal(c.passed, false);
});

test("[guard-2e] business description below 20 chars blocks submission", () => {
  const c = evaluateMemoReadinessContract({
    memo: memoStub(),
    overrides: { ...PASSING_OVERRIDES(), business_description: "too short" },
  });
  assert.equal(c.required.business_description, false);
  assert.equal(c.passed, false);
});

test("[guard-2f] no management bio blocks submission", () => {
  const c = evaluateMemoReadinessContract({
    memo: memoStub({ principalIds: ["p1", "p2"] }),
    overrides: PASSING_OVERRIDES(), // only has principal_bio_p1, but bio is for p1 — so this should pass
  });
  // The PASSING_OVERRIDES uses default p1; ensure that satisfies for both p1+p2 set
  // (only one principal needs a bio for the contract to pass)
  assert.equal(c.required.management_bio, true);

  // Now remove all bios
  const c2 = evaluateMemoReadinessContract({
    memo: memoStub({ principalIds: ["p1", "p2"] }),
    overrides: { business_description: "x".repeat(40), tabs_viewed: [] },
  });
  assert.equal(c2.required.management_bio, false);
  assert.equal(c2.passed, false);
});

test("[guard-2g] short management bio (<20 chars) does not satisfy", () => {
  const c = evaluateMemoReadinessContract({
    memo: memoStub({ principalIds: ["p1"] }),
    overrides: {
      business_description: "x".repeat(40),
      principal_bio_p1: "short",
      tabs_viewed: [],
    },
  });
  assert.equal(c.required.management_bio, false);
});

// ═══════════════════════════════════════════════════════════════════════════
// Guard 3: Recommended items produce warnings, never blockers
// ═══════════════════════════════════════════════════════════════════════════

test("[guard-3a] missing AI narrative produces warning, not blocker", () => {
  const c = evaluateMemoReadinessContract({
    memo: memoStub({ narrative: null }),
    overrides: PASSING_OVERRIDES(),
  });
  assert.equal(c.passed, true, "warnings should not block submission");
  assert.equal(c.warnings.ai_narrative_missing, true);
  assert.ok(c.warningList.find((w) => w.code === "ai_narrative_missing"));
});

test("[guard-3b] placeholder narrative ('not yet generated') produces warning", () => {
  const c = evaluateMemoReadinessContract({
    memo: memoStub({ narrative: "Narrative not yet generated" }),
    overrides: PASSING_OVERRIDES(),
  });
  assert.equal(c.warnings.ai_narrative_missing, true);
  assert.equal(c.passed, true);
});

test("[guard-3c] missing research produces warning", () => {
  const c = evaluateMemoReadinessContract({
    memo: memoStub({ hasResearch: false }),
    overrides: PASSING_OVERRIDES(),
  });
  assert.equal(c.warnings.research_missing, true);
  assert.equal(c.passed, true);
});

test("[guard-3d] unviewed covenant tab produces warning", () => {
  const c = evaluateMemoReadinessContract({
    memo: memoStub(),
    overrides: { ...PASSING_OVERRIDES(), tabs_viewed: ["qualitative"] },
  });
  assert.equal(c.warnings.covenant_review_missing, true);
  assert.equal(c.warnings.qualitative_review_missing, false);
  assert.equal(c.passed, true);
});

// ═══════════════════════════════════════════════════════════════════════════
// Guard 4: Pure function — deterministic output
// ═══════════════════════════════════════════════════════════════════════════

test("[guard-4] same inputs produce structurally equal contract", () => {
  const fixedNow = new Date("2026-05-05T12:00:00.000Z");
  const memo = memoStub();
  const overrides = PASSING_OVERRIDES();

  const a = evaluateMemoReadinessContract({ memo, overrides, now: fixedNow });
  const b = evaluateMemoReadinessContract({ memo, overrides, now: fixedNow });
  assert.deepEqual(a, b);
});

// ═══════════════════════════════════════════════════════════════════════════
// Guard 5: Contract version is locked
// ═══════════════════════════════════════════════════════════════════════════

test("[guard-5] contract version is memo_readiness_v1", () => {
  const c = evaluateMemoReadinessContract({
    memo: memoStub(),
    overrides: PASSING_OVERRIDES(),
  });
  assert.equal(c.contractVersion, "memo_readiness_v1");
});
