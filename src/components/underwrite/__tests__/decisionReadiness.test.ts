import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { deriveDecisionReadiness } from "../researchGatePhase";
import { EMPTY_RESEARCH_GATE_SNAPSHOT, type ResearchGateSnapshot } from "../researchGateTypes";

/**
 * SPEC-BIE-SAFE-PRIVATE-COMPANY-RESEARCH-HARDENING-1 — Phase 7
 * Research gate decision-readiness copy.
 */

function snap(over: Partial<ResearchGateSnapshot> = {}): ResearchGateSnapshot {
  return { ...EMPTY_RESEARCH_GATE_SNAPSHOT, ...over };
}

describe("deriveDecisionReadiness", () => {
  it("banker-certified preliminary → preliminary ready, committee not ready, blockers shown", () => {
    const r = deriveDecisionReadiness(snap({
      preliminaryEligible: true,
      committeeEligible: false,
      preliminaryBasis: "banker_certified_private_company",
      committeeBlockers: ["Public/attested entity verification required"],
      publicWebLimited: true,
    }));
    assert.equal(r.preliminary, "ready");
    assert.equal(r.committee, "not_ready");
    assert.equal(r.preliminaryBasisLabel, "banker-certified private-company evidence");
    assert.ok(r.committeeBlockers.length > 0);
    assert.match(r.publicWebNote ?? "", /expected for a private borrower/i);
  });

  it("not preliminary-eligible → preliminary not ready", () => {
    const r = deriveDecisionReadiness(snap());
    assert.equal(r.preliminary, "not_ready");
    assert.equal(r.committee, "not_ready");
    assert.equal(r.publicWebNote, null);
  });

  it("committee eligible → both ready", () => {
    const r = deriveDecisionReadiness(snap({
      gatePassed: true,
      preliminaryEligible: true,
      committeeEligible: true,
      preliminaryBasis: "public_web",
    }));
    assert.equal(r.preliminary, "ready");
    assert.equal(r.committee, "ready");
    assert.equal(r.preliminaryBasisLabel, "public sources");
  });

  it("gate passed implies preliminary ready even if eligibility flag absent", () => {
    const r = deriveDecisionReadiness(snap({ gatePassed: true }));
    assert.equal(r.preliminary, "ready");
  });
});
