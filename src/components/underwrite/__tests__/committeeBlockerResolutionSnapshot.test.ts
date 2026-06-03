import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { fetchResearchGateSnapshot } from "../fetchResearchGateSnapshot";
import { deriveResearchGatePhase } from "../researchGatePhase";

/**
 * SPEC-BIE-EVIDENCE-GRAPH-AND-COMMITTEE-BLOCKER-RESOLUTION-1
 * Serialization: the quality payload's committee_blocker_resolutions flow into
 * the snapshot; preliminary stays passed, committee stays blocked.
 */

const RESOLUTIONS = [
  {
    blocker_id: "stronger_public_institutional_sources_required",
    title: "Stronger public/institutional sources required",
    blocker_type: "source_quality",
    severity: "committee_blocker",
    current_status: "present_but_not_committee_grade",
    why_it_blocks_committee: "Public source quality is 15% with no primary/institutional sources.",
    existing_supporting_evidence: [{ section: "Borrower Profile", claim_preview: "OmniCare365 is a BPO." }],
    missing_evidence: ["At least one primary/institutional public source"],
    recommended_actions: ["Add the borrower official website as a source"],
    acceptable_evidence_examples: ["Secretary-of-state record"],
    can_be_banker_certified_for_preliminary: true,
    requires_public_or_attested_evidence_for_committee: true,
  },
];

const QUALITY_PAYLOAD = {
  ok: true,
  committee_blocker_resolutions: RESOLUTIONS,
  gate: {
    gate_passed: false,
    trust_grade: "preliminary",
    quality_score: 65,
    gate_failures: [],
    preliminary_eligible: true,
    committee_eligible: false,
    preliminary_basis: "banker_certified_private_company",
    committee_blockers: ["Stronger public/institutional sources required"],
    evidence_quality: { public_web_limited: true },
  },
};
const FLIGHT_PAYLOAD = { ok: true, research: { status: "complete" }, groups: null };

let originalFetch: typeof globalThis.fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => ({
    json: async () => (String(url).includes("/research/quality") ? QUALITY_PAYLOAD : FLIGHT_PAYLOAD),
  })) as unknown as typeof globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("committee_blocker_resolutions serialization", () => {
  it("snapshot carries committeeBlockerResolutions from the quality payload", async () => {
    const snap = await fetchResearchGateSnapshot("deal-1");
    assert.equal(snap.committeeBlockerResolutions.length, 1);
    assert.equal(snap.committeeBlockerResolutions[0].blocker_type, "source_quality");
    assert.ok(snap.committeeBlockerResolutions[0].recommended_actions.length > 0);
  });

  it("preliminary stays eligible/clear and committee stays blocked", async () => {
    const snap = await fetchResearchGateSnapshot("deal-1");
    assert.equal(snap.preliminaryEligible, true);
    assert.equal(snap.committeeEligible, false);
    assert.equal(snap.trustGrade, "preliminary");
  });

  it("gate not passed → phase gate_failed (panel renders the resolution section)", async () => {
    const snap = await fetchResearchGateSnapshot("deal-1");
    const phase = deriveResearchGatePhase(snap, /* workspaceReady */ true, null);
    assert.equal(phase, "gate_failed");
  });

  it("missing resolutions field degrades to empty array (no throw)", async () => {
    globalThis.fetch = (async (url: string) => ({
      json: async () =>
        String(url).includes("/research/quality")
          ? { ok: true, gate: { gate_passed: false, trust_grade: "preliminary" } }
          : FLIGHT_PAYLOAD,
    })) as unknown as typeof globalThis.fetch;
    const snap = await fetchResearchGateSnapshot("deal-1");
    assert.deepEqual(snap.committeeBlockerResolutions, []);
  });
});
