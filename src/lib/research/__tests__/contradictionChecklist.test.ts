import test from "node:test";
import assert from "node:assert/strict";

import {
  buildContradictionChecklist,
  summarizeContradictionChecklist,
  extractMentionedRevenueFigures,
  REQUIRED_CONTRADICTION_CHECKS,
  type ContradictionContext,
} from "@/lib/research/contradictionChecklist";

/**
 * SPEC-BIE-SAFE-PRIVATE-COMPANY-RESEARCH-HARDENING-1 — Phase 4
 * Always-emit 8-check contradiction checklist.
 */

function ctx(over: Partial<ContradictionContext> = {}): ContradictionContext {
  return {
    contradictionsText: "",
    entityConflict: false,
    entityConfirmedPublicly: false,
    hasBankerCertifiedIdentity: false,
    hasLegalIdentity: false,
    managementBasis: null,
    managementProfileOnFile: false,
    managementPubliclyConfirmed: false,
    hasBorrowerThread: false,
    hasMarketThread: false,
    hasIndustryThread: false,
    hasCompetitiveThread: false,
    hasTransactionThread: false,
    hasRevenue: false,
    namedCompetitors: 0,
    ...over,
  };
}

const get = (cs: ReturnType<typeof buildContradictionChecklist>, k: string) =>
  cs.find((c) => c.check_key === k)!;

test("[contradiction] all 8 checks always emitted", () => {
  const cs = buildContradictionChecklist(ctx());
  assert.equal(cs.length, 8);
  for (const k of REQUIRED_CONTRADICTION_CHECKS) {
    assert.ok(cs.some((c) => c.check_key === k), `missing ${k}`);
  }
});

test("[contradiction] empty evidence → insufficient_evidence, addressed, committee-blocking", () => {
  const cs = buildContradictionChecklist(ctx());
  const sum = summarizeContradictionChecklist(cs);
  // every check is "addressed"
  assert.equal(sum.addressed, 8);
  // but many are committee blockers
  assert.ok(sum.committeeBlockers.length > 0);
  // each emitted status is one of the three addressed states
  for (const c of cs) {
    assert.ok(["clear", "flagged", "insufficient_evidence"].includes(c.status));
  }
});

test("[contradiction] wrong-entity conflict → identity_mismatch error + committee blocker", () => {
  const cs = buildContradictionChecklist(ctx({ entityConflict: true }));
  const id = get(cs, "identity_mismatch");
  assert.equal(id.status, "flagged");
  assert.equal(id.severity, "error");
  assert.equal(id.committee_blocker, true);
  assert.equal(summarizeContradictionChecklist(cs).hasError, true);
});

test("[contradiction] banker-certified identity (no conflict) → identity clear, not error", () => {
  const cs = buildContradictionChecklist(ctx({ hasBankerCertifiedIdentity: true, hasLegalIdentity: true }));
  const id = get(cs, "identity_mismatch");
  assert.equal(id.status, "clear");
  assert.equal(id.severity, "info");
  assert.equal(id.evidence_basis, "banker_certified");
});

test("[contradiction] dba/geography use legal identity / market thread", () => {
  const cs = buildContradictionChecklist(ctx({ hasLegalIdentity: true, hasMarketThread: true }));
  assert.equal(get(cs, "dba_mismatch").status, "clear");
  assert.equal(get(cs, "geography_mismatch").status, "clear");
});

test("[contradiction] management fallback caveat surfaces in management_history_conflict", () => {
  const cs = buildContradictionChecklist(ctx({ managementProfileOnFile: true, managementBasis: "fallback" }));
  const m = get(cs, "management_history_conflict");
  assert.equal(m.status, "insufficient_evidence");
  assert.equal(m.evidence_basis, "fallback");
  assert.equal(m.committee_blocker, true);
  assert.match(m.basis, /banker-certified\/file-based/i);
});

test("[contradiction] no hallucinated pass when evidence missing", () => {
  const cs = buildContradictionChecklist(ctx());
  // regulatory/competitive/repayment have no thread → must NOT be clear
  for (const k of ["regulatory_vs_margin", "competitive_position_conflict", "repayment_story_conflict"]) {
    assert.notEqual(get(cs, k).status, "clear", `${k} should not falsely clear`);
  }
});

// ── Regression for specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md: real
// cross-thread numeric diffing for scale_plausibility, instead of trusting
// only the LLM's self-reported "contradictions" text. ──────────────────────

test("[extractMentionedRevenueFigures] parses common dollar-figure phrasings", () => {
  assert.deepEqual(extractMentionedRevenueFigures("generates approximately $12 million in annual revenue"), [12_000_000]);
  assert.deepEqual(extractMentionedRevenueFigures("revenue of $1.2 billion last year"), [1_200_000_000]);
  assert.deepEqual(extractMentionedRevenueFigures("reported $500,000 in sales"), [500_000]);
  assert.deepEqual(extractMentionedRevenueFigures("no dollar figures here"), []);
  assert.deepEqual(extractMentionedRevenueFigures(null), []);
});

test("[contradiction] scale_plausibility flags a real numeric mismatch (loan file vs. narrative)", () => {
  const cs = buildContradictionChecklist(ctx({
    hasBorrowerThread: true,
    hasRevenue: true,
    annualRevenue: 2_000_000, // loan file: $2M
    borrowerScaleText: "The company reports approximately $50 million in annual revenue.", // narrative: $50M — 25x apart
  }));
  const check = get(cs, "scale_plausibility");
  assert.equal(check.status, "flagged");
  assert.equal(check.committee_blocker, true);
  assert.match(check.basis, /cross-thread numeric check/i);
});

test("[contradiction] scale_plausibility clears when narrative figure matches loan file (real comparison, not presence-only)", () => {
  const cs = buildContradictionChecklist(ctx({
    hasBorrowerThread: true,
    hasRevenue: true,
    annualRevenue: 2_000_000,
    borrowerScaleText: "The company reports approximately $2.1 million in annual revenue.",
  }));
  const check = get(cs, "scale_plausibility");
  assert.equal(check.status, "clear");
  assert.equal(check.committee_blocker, false);
  assert.match(check.basis, /cross-thread numeric check/i);
});

test("[contradiction] scale_plausibility falls back to insufficient_evidence when no comparable figure is mentioned", () => {
  const cs = buildContradictionChecklist(ctx({
    hasBorrowerThread: true,
    hasRevenue: true,
    annualRevenue: 2_000_000,
    borrowerScaleText: "The company has a strong reputation and positive reviews.",
  }));
  const check = get(cs, "scale_plausibility");
  assert.equal(check.status, "insufficient_evidence");
  assert.equal(check.committee_blocker, false);
});

// ── repayment_story_conflict: real cross-thread numeric diffing ─────────────
// (specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md round 5) — same machinery as
// scale_plausibility, but comparing the TRANSACTION thread's own repayment
// narrative against the loan-file revenue, not the borrower thread's.

test("[contradiction] repayment_story_conflict flags a real numeric mismatch (loan file vs. transaction narrative)", () => {
  const cs = buildContradictionChecklist(ctx({
    hasTransactionThread: true,
    annualRevenue: 2_000_000, // loan file: $2M
    transactionRepaymentText: "Primary repayment source is operating cash flow, which generates approximately $40 million annually.", // 20x apart
  }));
  const check = get(cs, "repayment_story_conflict");
  assert.equal(check.status, "flagged");
  assert.equal(check.committee_blocker, true);
  assert.match(check.basis, /cross-thread numeric check/i);
});

test("[contradiction] repayment_story_conflict clears when transaction narrative figure matches loan file", () => {
  const cs = buildContradictionChecklist(ctx({
    hasTransactionThread: true,
    annualRevenue: 2_000_000,
    transactionRepaymentText: "Primary repayment source is operating cash flow of approximately $2.1 million annually.",
  }));
  const check = get(cs, "repayment_story_conflict");
  assert.equal(check.status, "clear");
  assert.equal(check.committee_blocker, false);
  assert.match(check.basis, /cross-thread numeric check/i);
});

test("[contradiction] repayment_story_conflict falls back to presence-only clear when no comparable figure is mentioned", () => {
  const cs = buildContradictionChecklist(ctx({
    hasTransactionThread: true,
    annualRevenue: 2_000_000,
    transactionRepaymentText: "Repayment relies on stable, diversified customer contracts.",
  }));
  const check = get(cs, "repayment_story_conflict");
  assert.equal(check.status, "clear");
  assert.equal(check.committee_blocker, false);
  assert.doesNotMatch(check.basis, /cross-thread numeric check/i);
});

test("[contradiction] repayment_story_conflict still honors the LLM self-report when no numeric comparison is possible", () => {
  const cs = buildContradictionChecklist(ctx({
    hasTransactionThread: true,
    contradictionsText: "There is a repayment story conflict between stated revenue and actual cash flow.",
  }));
  const check = get(cs, "repayment_story_conflict");
  assert.equal(check.status, "flagged");
  assert.equal(check.committee_blocker, true);
});

test("[contradiction] full evidence → clears non-blocking checks", () => {
  const cs = buildContradictionChecklist(ctx({
    entityConfirmedPublicly: true,
    hasLegalIdentity: true,
    managementPubliclyConfirmed: true,
    hasBorrowerThread: true,
    hasMarketThread: true,
    hasIndustryThread: true,
    hasCompetitiveThread: true,
    hasTransactionThread: true,
    hasRevenue: true,
    namedCompetitors: 3,
  }));
  const sum = summarizeContradictionChecklist(cs);
  assert.equal(sum.committeeBlockers.length, 0);
  assert.equal(sum.hasError, false);
});
