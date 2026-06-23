import test from "node:test";
import assert from "node:assert/strict";

import {
  buildContradictionChecklist,
  summarizeContradictionChecklist,
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
