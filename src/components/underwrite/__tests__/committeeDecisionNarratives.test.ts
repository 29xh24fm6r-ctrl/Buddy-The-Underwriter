import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildInstitutionalDecisionNarratives } from "../committeeReadinessView";
import { EMPTY_RESEARCH_GATE_SNAPSHOT, type ResearchGateSnapshot } from "../researchGateTypes";

/**
 * SPEC-BIE-INSTITUTIONAL-DECISION-NARRATIVES-1
 * Pure, deterministic decision narratives projected from existing snapshot data.
 */

function task(over: Record<string, unknown>): any {
  return { id: "t", blocker_id: "b", task_type: "manual_review", status: "pending", resolved_status: "missing", review_status: "unreviewed", ...over };
}
function blocker(over: Record<string, unknown>): any {
  return {
    blocker_id: "b", blocker_type: "other", title: "Blocker", current_status: "missing",
    why_it_blocks_committee: "Committee needs this.", missing_evidence: [], existing_supporting_evidence: [],
    recommended_actions: [], acceptable_evidence_examples: [], can_be_banker_certified_for_preliminary: false,
    requires_public_or_attested_evidence_for_committee: true, evidence_tasks: [], ...over,
  };
}
function snap(blockers: any[]): ResearchGateSnapshot {
  return { ...EMPTY_RESEARCH_GATE_SNAPSHOT, gatePassed: true, committeeEligible: false, committeeBlockerResolutions: blockers } as ResearchGateSnapshot;
}

describe("Public Records Review narrative", () => {
  it("a banker-attested clean screen is approve-ready with High confidence", () => {
    const n = buildInstitutionalDecisionNarratives(
      snap([blocker({ blocker_id: "adverse", blocker_type: "adverse_screen", title: "Public adverse screen", current_status: "resolved", evidence_tasks: [task({ id: "adv", blocker_id: "adverse", task_type: "public_adverse_screen", review_status: "banker_attested", review_reason: "screening_result:clear" })] })]),
    ).risk;
    assert.equal(n.recommendation, "Approve");
    assert.equal(n.confidence, "High");
  });

  it("a Buddy-receipt / search-form-only capture is never official and lowers confidence", () => {
    const n = buildInstitutionalDecisionNarratives(
      snap([blocker({ blocker_id: "adverse", blocker_type: "adverse_screen", title: "Public adverse screen", current_status: "present_but_not_committee_grade", evidence_tasks: [task({ id: "adv", blocker_id: "adverse", task_type: "public_adverse_screen", resolved_status: "needs_review", artifact_view_url: "/api/x?artifact_id=a", official_capture_available: false, official_capture_status: "search_form_only" })] })]),
    ).risk;
    assert.notEqual(n.confidence, "High");
    assert.ok(n.evidenceUsed.every((e) => e.strength !== "Strong"), "receipt/search-form is not Strong evidence");
    assert.ok([...n.keyFindings, ...n.riskNotes].some((x) => /search form/i.test(x)));
  });
});

describe("Management Quality narrative", () => {
  it("names the principal when present and does not use a generic section label as primary evidence", () => {
    const n = buildInstitutionalDecisionNarratives(
      snap([blocker({ blocker_id: "mgmt", blocker_type: "management_verification", title: "Management verification", current_status: "present_but_not_committee_grade", existing_supporting_evidence: [{ section: "Management Intelligence", claim_preview: "Principal: Matt Hunt — CEO, 15 years in home health" }], evidence_tasks: [task({ id: "m", blocker_id: "mgmt", task_type: "management_attestation", resolved_status: "needs_review" })] })]),
    ).management;
    assert.ok(n.evidenceUsed.some((e) => /Matt Hunt/.test(e.label)), "names the principal");
    assert.equal(n.evidenceUsed[0].label.startsWith("Research support for"), false);
    assert.ok(/Approve with caveat|Approve/.test(n.recommendation));
  });

  it("no management evidence → Request more support + Low confidence", () => {
    const n = buildInstitutionalDecisionNarratives(
      snap([blocker({ blocker_id: "mgmt", blocker_type: "management_verification", title: "Management verification", current_status: "missing", evidence_tasks: [task({ id: "m", blocker_id: "mgmt", task_type: "management_attestation", resolved_status: "missing" })] })]),
    ).management;
    assert.equal(n.recommendation, "Request more support");
    assert.equal(n.confidence, "Low");
  });
});

describe("Industry Validation narrative", () => {
  it("surfaces NAICS when present in the evidence", () => {
    const n = buildInstitutionalDecisionNarratives(
      snap([blocker({ blocker_id: "ind", blocker_type: "section_source_gap", title: "Industry source: 621610 — Home Health Care Services", current_status: "missing", evidence_tasks: [task({ id: "i", blocker_id: "ind", task_type: "industry_market_source", resolved_status: "missing" })] })]),
    ).industry;
    assert.ok(n.keyFindings.some((f) => /621610/.test(f)), "NAICS shown");
    assert.equal(n.confidence, "Low"); // borrower-only, no source
  });
});

describe("Business Scale narrative", () => {
  const scaleSnap = () => snap([blocker({ blocker_id: "scale", blocker_type: "contradiction_gap", title: "Contradiction unresolved: scale plausibility", current_status: "missing", evidence_tasks: [task({ id: "s", blocker_id: "scale", task_type: "scale_plausibility", resolved_status: "missing", auto_clear_forbidden: true })] })]);

  it("shows all six scale factors as key findings", () => {
    const n = buildInstitutionalDecisionNarratives(scaleSnap()).scale;
    const text = n.keyFindings.join(" ").toLowerCase();
    for (const re of [/revenue/, /use-of-proceeds|loan request/, /ar|customer/, /capacity|staffing/, /collateral/, /industry/]) {
      assert.ok(re.test(text), `scale factor missing: ${re}`);
    }
  });

  it("missing revenue/use-of-proceeds → Unable to conclude, not High", () => {
    const n = buildInstitutionalDecisionNarratives(scaleSnap()).scale;
    assert.equal(n.recommendation, "Unable to conclude");
    assert.notEqual(n.confidence, "High");
  });

  it("capacity/staffing is explicitly Missing when not derivable", () => {
    const n = buildInstitutionalDecisionNarratives(scaleSnap()).scale;
    assert.ok(n.keyFindings.some((f) => /staffing|capacity/i.test(f) && /missing/i.test(f)));
  });
});

describe("narratives carry no internal workflow vocabulary", () => {
  it("conclusion / findings / guidance use banker language only", () => {
    const all = Object.values(buildInstitutionalDecisionNarratives(
      snap([
        blocker({ blocker_id: "mgmt", blocker_type: "management_verification", title: "Management", evidence_tasks: [task({ id: "m", blocker_id: "mgmt", task_type: "management_attestation", resolved_status: "needs_review" })] }),
        blocker({ blocker_id: "scale", blocker_type: "contradiction_gap", title: "scale plausibility", evidence_tasks: [task({ id: "s", blocker_id: "scale", task_type: "scale_plausibility", resolved_status: "missing", auto_clear_forbidden: true })] }),
      ]),
    ));
    const text = all
      .flatMap((n) => [n.conclusion, n.bankerGuidance, ...n.keyFindings, ...n.evidenceGaps, ...n.riskNotes, ...n.evidenceUsed.map((e) => e.label)])
      .join(" ")
      .toLowerCase();
    for (const term of ["committee_grade", "committee-grade", "auto_clear_forbidden", "review_status", "task_type", "blocker_type", "resolved_status"]) {
      assert.ok(!text.includes(term), `leaked: ${term}`);
    }
  });
});
