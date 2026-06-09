import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildCreditMemoV1 } from "@/lib/creditMemo/buildCreditMemo";
import { memoCommitteeIntelligenceFromSnapshot } from "../buildMemoCommitteeIntelligence";
import { EMPTY_RESEARCH_GATE_SNAPSHOT, type ResearchGateSnapshot } from "@/components/underwrite/researchGateTypes";

/**
 * SPEC-CREDIT-MEMO-CONSUME-COMMITTEE-INTELLIGENCE-1 (PR-B)
 * The memo build pushes a "committee_readiness" section derived from the same
 * snapshot the Committee Readiness screen renders.
 */

function blocker(over: Record<string, unknown>): any {
  return {
    blocker_id: "b", blocker_type: "other", title: "Blocker", current_status: "missing",
    why_it_blocks_committee: "why", missing_evidence: [], existing_supporting_evidence: [],
    recommended_actions: [], acceptable_evidence_examples: [], evidence_tasks: [],
    can_be_banker_certified_for_preliminary: false, requires_public_or_attested_evidence_for_committee: true, ...over,
  };
}
function task(over: Record<string, unknown>): any {
  return { id: "t", blocker_id: "b", task_type: "manual_review", status: "pending", resolved_status: "missing", review_status: "unreviewed", ...over };
}
function omniSnapshot(): ResearchGateSnapshot {
  const f = (factor: string, ec: string) => ({ factor, status: "Supported", evidenceClass: ec, label: `${factor} on file`, reason: "" });
  return {
    ...EMPTY_RESEARCH_GATE_SNAPSHOT,
    gatePassed: true, preliminaryEligible: true, committeeEligible: false,
    committeeBlockerResolutions: [
      blocker({ blocker_id: "mgmt", blocker_type: "management_verification", title: "Mgmt", current_status: "present_but_not_committee_grade", evidence_tasks: [task({ task_type: "management_attestation", status: "collected", resolved_status: "collected" })] }),
      blocker({ blocker_id: "industry", blocker_type: "section_source_gap", title: "Industry Overview", current_status: "present_but_not_committee_grade", evidence_tasks: [task({ task_type: "industry_market_source", status: "collected", resolved_status: "collected", source_snapshot_id: "s1" })] }),
      blocker({ blocker_id: "scale", blocker_type: "contradiction_gap", title: "scale plausibility", current_status: "missing", evidence_tasks: [task({ task_type: "scale_plausibility", auto_clear_forbidden: true })] }),
    ],
    committeeBlockers: ["Contradiction check unresolved: scale_plausibility"],
    committeeDecisionEvidence: {
      privateCompanyEvidenceMode: true, scalePlausibilityUnresolved: true,
      scaleFactors: [f("Revenue support", "file_supported"), f("Loan request / use of proceeds", "file_supported"), f("AR / customer concentration", "file_supported"), f("Capacity / staffing", "file_supported"), f("Collateral support", "file_supported"), { factor: "Industry context", status: "Partially supported", evidenceClass: "public_supported", label: "x", reason: "" }],
      industry: { naicsCode: "561422", naicsDescription: "Telemarketing", understanding: { factor: "Industry understanding", status: "Supported", evidenceClass: "borrower_supported", label: "x", reason: "" }, independentSource: { factor: "Independent industry source", status: "Supported", evidenceClass: "public_supported", label: "x", reason: "" } },
      management: { principals: [{ name: "Matt Hunt", title: "President" }], profilePresent: true, publicVerification: true, adverseStatus: "manual_clear_attested" },
      publicRecords: { attestedClear: true, officialCaptured: false, searchFormOnly: false, status: "manual_clear_attested" },
    } as any,
  } as ResearchGateSnapshot;
}

const UW: any = {
  low_confidence_years: [], policy_min_dscr: 1.25, worst_dscr: 1.4, worst_year: 2023, weighted_dscr: 1.5,
  stressed_dscr: 1.3, cfads_trend: "stable", revenue_trend: "up", flags: [], annual_debt_service: 100000,
};
const VERDICT: any = { headline: "Approve", rationale: ["ok"], key_drivers: [], mitigants: [], level: "approve" };

function buildMemo(withCommittee: boolean) {
  return buildCreditMemoV1({
    dealId: "dc52c626", yearsDetected: [2023], spreadsByYear: {} as any,
    underwritingResults: UW, verdict: VERDICT, narrative: "n", hasPfs: true, hasFinancialStatement: true,
    committeeIntelligence: withCommittee ? memoCommitteeIntelligenceFromSnapshot(omniSnapshot()) : null,
  });
}

describe("credit memo committee_readiness section (PR-B)", () => {
  it("pushes a committee_readiness section reflecting the readiness model", () => {
    const memo = buildMemo(true);
    const section = memo.sections.find((s) => s.id === "committee_readiness")!;
    assert.ok(section, "committee_readiness section present");
    assert.match(section.body, /Committee review is not ready/);
    assert.match(section.body, /561422/);
    assert.match(section.body, /supported by file evidence/);
    assert.match(section.body, /analyst scale-plausibility conclusion (is )?still required/i);
    // Exact remaining blockers as bullets; industry is review-required, not missing.
    assert.ok(section.bullets!.some((b) => /Industry source review required/.test(b)));
    assert.equal(section.bullets!.some((b) => /Industry support missing/.test(b)), false);
    assert.ok(section.bullets!.some((b) => /Management support missing/.test(b)));
    assert.ok(section.bullets!.some((b) => /Analyst conclusion missing/.test(b)));
    assert.deepEqual(section.flags, ["Committee review not ready"]);
    // Must NOT overstate scale or industry.
    assert.doesNotMatch(section.body, /independent .*source is still missing/i);
  });

  it("omits the section when no committee intelligence is provided (back-compat)", () => {
    const memo = buildMemo(false);
    assert.equal(memo.sections.some((s) => s.id === "committee_readiness"), false);
  });

  it("the snapshot helper returns null when there is no committee model", () => {
    assert.equal(memoCommitteeIntelligenceFromSnapshot(EMPTY_RESEARCH_GATE_SNAPSHOT), null);
  });
});
