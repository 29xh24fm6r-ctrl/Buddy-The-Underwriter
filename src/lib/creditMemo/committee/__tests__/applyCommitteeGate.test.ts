import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  committeeGateCaveat,
  applyCommitteeGateToRecommendation,
  committeeGateConditions,
  isCommitteeEligible,
} from "../applyCommitteeGate";
import type { MemoCommitteeReadinessSection } from "../buildMemoCommitteeReadinessSection";

/** SPEC-CREDIT-MEMO-PERFECTION-PROGRAM-1 Phase 1 — decision coherence. */

const notReady = (blockers: string[]): MemoCommitteeReadinessSection =>
  ({ committee_ready: false, status_line: "Not ready for committee review.", remaining_blockers: blockers, decision_support: [], sources: [], markdown: "" });
const ready = (): MemoCommitteeReadinessSection =>
  ({ committee_ready: true, status_line: "Ready for committee review.", remaining_blockers: [], decision_support: [], sources: [], markdown: "" });

const rec = () => ({ verdict: "approve", rationale: ["Coverage meets policy."], exceptions: ["LTV exception"] });

describe("recommendation caveat", () => {
  it("keeps the financial verdict but prepends an explicit caveat when not ready", () => {
    const out = applyCommitteeGateToRecommendation(rec(), notReady(["Management support missing", "Analyst conclusion missing"]));
    assert.equal(out.verdict, "approve"); // financial verdict preserved
    assert.match(out.rationale[0], /Committee approval is gated/);
    assert.match(out.rationale[0], /not a committee approval until these are resolved/);
    assert.match(out.rationale[0], /Management support missing; Analyst conclusion missing/);
    assert.equal(out.rationale.length, 2); // caveat + original
    assert.ok(out.exceptions.includes("Committee blocker: Management support missing"));
  });

  it("leaves the recommendation untouched when committee is ready", () => {
    const r = rec();
    const out = applyCommitteeGateToRecommendation(r, ready());
    assert.deepEqual(out, r);
    assert.equal(committeeGateCaveat(ready()), null);
    assert.equal(committeeGateCaveat(null), null);
  });
});

describe("conditions-precedent from blockers", () => {
  it("renders each remaining blocker as a condition when not ready; none when ready/absent", () => {
    assert.deepEqual(committeeGateConditions(notReady(["Industry source review required"])), [
      "Resolve committee blocker before committee submission: Industry source review required",
    ]);
    assert.deepEqual(committeeGateConditions(ready()), []);
    assert.deepEqual(committeeGateConditions(null), []);
  });
});

describe("single authoritative committee eligibility", () => {
  it("committee_readiness wins when present", () => {
    assert.equal(isCommitteeEligible({ financialReady: true, trustGrade: "committee_grade", evidenceBlockersClear: true, section: notReady(["x"]) }), false);
    assert.equal(isCommitteeEligible({ financialReady: true, trustGrade: "preliminary", evidenceBlockersClear: false, section: ready() }), true);
  });
  it("requires financial readiness regardless", () => {
    assert.equal(isCommitteeEligible({ financialReady: false, trustGrade: "committee_grade", evidenceBlockersClear: true, section: ready() }), false);
  });
  it("falls back to trust-grade only when no committee model exists", () => {
    assert.equal(isCommitteeEligible({ financialReady: true, trustGrade: "committee_grade", evidenceBlockersClear: true, section: null }), true);
    assert.equal(isCommitteeEligible({ financialReady: true, trustGrade: "preliminary", evidenceBlockersClear: true, section: null }), false);
    assert.equal(isCommitteeEligible({ financialReady: true, trustGrade: "committee_grade", evidenceBlockersClear: false, section: null }), false);
  });
});
