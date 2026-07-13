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
  businessDescription: string;
  principalBios: Record<string, string>;
  arBorrowingBase: unknown;
  bankerContext: { banker_notes: string } | undefined;
}> = {}): CanonicalCreditMemoV1 {
  const pids = opts.principalIds ?? ["p1"];
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
      ar_borrowing_base: opts.arBorrowingBase ?? null,
      line_items: [],
    },
    business_summary: {
      business_description: opts.businessDescription ?? "Pending",
    },
    banker_context: opts.bankerContext,
    management_qualifications: {
      principals: pids.map((id) => ({
        id,
        name: id,
        bio: opts.principalBios?.[id] ?? "Pending — complete interview.",
      })),
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
// Guard 3: AI narrative is a hard blocker; the rest are warnings only
// ═══════════════════════════════════════════════════════════════════════════

test("[guard-3a] missing AI narrative blocks submission", () => {
  // The AI narrative becomes part of the frozen banker-certified snapshot,
  // so a memo with no narrative at all must not be submittable — this used
  // to only be a non-blocking warning, which let a narrative-less memo reach
  // committee. "narrative" is Required in buildRequiredItems, and this
  // server contract must agree with that (see the file-level invariant
  // comment: client UI and server gate must never diverge).
  const c = evaluateMemoReadinessContract({
    memo: memoStub({ narrative: null }),
    overrides: PASSING_OVERRIDES(),
  });
  assert.equal(c.required.ai_narrative_present, false);
  assert.equal(c.passed, false, "missing narrative should block submission");
  assert.ok(c.blockers.find((b) => b.code === "ai_narrative_present"));
  // Still recorded as a warning too, for backward-compatible warning consumers.
  assert.equal(c.warnings.ai_narrative_missing, true);
  assert.ok(c.warningList.find((w) => w.code === "ai_narrative_missing"));
});

test("[guard-3b] placeholder narrative ('not yet generated') blocks submission", () => {
  const c = evaluateMemoReadinessContract({
    memo: memoStub({ narrative: "Narrative not yet generated" }),
    overrides: PASSING_OVERRIDES(),
  });
  assert.equal(c.required.ai_narrative_present, false);
  assert.equal(c.warnings.ai_narrative_missing, true);
  assert.equal(c.passed, false);
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

// ═══════════════════════════════════════════════════════════════════════════
// Guard 6: Canonical-first readiness (no overrides required)
// ═══════════════════════════════════════════════════════════════════════════

test("[guard-6a] canonical memo data satisfies all required items without overrides", () => {
  const c = evaluateMemoReadinessContract({
    memo: memoStub({
      businessDescription: "OmniCare365 provides comprehensive home healthcare staffing services to hospitals and facilities across the southeast.",
      principalBios: { p1: "Founded OmniCare 365 in 2018. 25+ years in healthcare staffing. Prior: VP of Operations. Credit: Strong personal credit." },
      arBorrowingBase: { total_ar: 3_000_000, eligible_ar: 2_800_000, advance_rate: 0.80 },
    }),
    overrides: {}, // No legacy overrides at all
  });
  assert.equal(c.passed, true, `Expected pass, got blockers: ${c.blockers.map((b) => b.code).join(", ")}`);
  assert.equal(c.required.business_description, true);
  assert.equal(c.required.management_bio, true);
  assert.equal(c.required.collateral_value, true);
});

test("[guard-6b] canonical business description missing + no override = blocker", () => {
  const c = evaluateMemoReadinessContract({
    memo: memoStub({
      principalBios: { p1: "Founded company. 25+ years in industry. Credit: Strong." },
    }),
    overrides: {},
  });
  assert.equal(c.required.business_description, false);
  assert.equal(c.passed, false);
  assert.ok(c.blockers.some((b) => b.code === "business_description"));
});

test("[guard-6c] canonical management bio missing + no override = blocker", () => {
  const c = evaluateMemoReadinessContract({
    memo: memoStub({
      businessDescription: "This is a real business description longer than twenty characters.",
    }),
    overrides: {},
  });
  assert.equal(c.required.management_bio, false);
  assert.equal(c.passed, false);
  assert.ok(c.blockers.some((b) => b.code === "management_bio"));
});

test("[guard-6d] AR borrowing-base satisfies collateral without gross_value", () => {
  const c = evaluateMemoReadinessContract({
    memo: memoStub({
      collateralGross: null,
      arBorrowingBase: { total_ar: 3_000_000, eligible_ar: 2_800_000 },
      businessDescription: "Real business description here with enough length.",
      principalBios: { p1: "Real management bio with enough length to satisfy the check." },
    }),
    overrides: {},
  });
  assert.equal(c.required.collateral_value, true, "AR BB must satisfy collateral");
  assert.equal(c.passed, true);
});

test("[guard-6e] legacy overrides still work for older deals", () => {
  // Memo has no canonical business desc or bio, but overrides have them
  const c = evaluateMemoReadinessContract({
    memo: memoStub(),
    overrides: PASSING_OVERRIDES(),
  });
  assert.equal(c.passed, true, "Legacy overrides must still pass");
  assert.equal(c.required.business_description, true);
  assert.equal(c.required.management_bio, true);
});

test("[guard-6f] blocker labels use canonical wording", () => {
  const c = evaluateMemoReadinessContract({
    memo: memoStub({ collateralGross: null }),
    overrides: {},
  });
  const collatBlocker = c.blockers.find((b) => b.code === "collateral_value");
  assert.ok(collatBlocker);
  assert.equal(collatBlocker!.label, "Collateral is not available");

  const bizBlocker = c.blockers.find((b) => b.code === "business_description");
  assert.ok(bizBlocker);
  assert.equal(bizBlocker!.label, "Business profile is not available");

  const mgmtBlocker = c.blockers.find((b) => b.code === "management_bio");
  assert.ok(mgmtBlocker);
  assert.equal(mgmtBlocker!.label, "Management profile is not available");
});

// ─── SPEC-CREDIT-MEMO-PERFECTION-PROGRAM-1 Phase 1: committee readiness gate ───
function withCommittee(memo: CanonicalCreditMemoV1, committee_ready: boolean, remaining: string[] = []) {
  (memo as any).committee_readiness = { committee_ready, status_line: "", remaining_blockers: remaining, decision_support: [], sources: [], markdown: "" };
  return memo;
}

test("[committee] not ready → blocks submission with a committee_ready blocker", () => {
  const c = evaluateMemoReadinessContract({
    memo: withCommittee(memoStub(), false, ["Management support missing", "Analyst conclusion missing"]),
    overrides: PASSING_OVERRIDES(),
  });
  assert.equal(c.passed, false);
  assert.equal(c.required.committee_ready, false);
  const b = c.blockers.find((x) => x.code === "committee_ready");
  assert.ok(b, "committee blocker present");
  assert.match(b!.label, /Management support missing; Analyst conclusion missing/);
});

test("[committee] overridable — a banker reason clears the block + records an audited warning", () => {
  const c = evaluateMemoReadinessContract({
    memo: withCommittee(memoStub(), false, ["Analyst conclusion missing"]),
    overrides: { ...PASSING_OVERRIDES(), committee_not_ready_override: "Chair approved verbal; minutes to follow" },
  });
  assert.equal(c.passed, true);
  assert.equal(c.required.committee_ready, true);
  assert.equal(c.blockers.some((x) => x.code === "committee_ready"), false);
  const w = c.warningList.find((x) => x.code === "committee_not_ready_overridden");
  assert.ok(w, "override warning recorded");
  assert.match(w!.label, /Chair approved verbal/);
});

test("[committee] ready → no committee blocker", () => {
  const c = evaluateMemoReadinessContract({ memo: withCommittee(memoStub(), true), overrides: PASSING_OVERRIDES() });
  assert.equal(c.passed, true);
  assert.equal(c.required.committee_ready, true);
});

test("[committee] no committee model → gate is satisfied (back-compat)", () => {
  const c = evaluateMemoReadinessContract({ memo: memoStub(), overrides: PASSING_OVERRIDES() });
  assert.equal(c.required.committee_ready, true);
  assert.equal(c.blockers.some((x) => x.code === "committee_ready"), false);
});
