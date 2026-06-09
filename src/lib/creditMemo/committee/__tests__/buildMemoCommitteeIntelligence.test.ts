import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildMemoCommitteeIntelligence } from "../buildMemoCommitteeIntelligence";
import {
  buildCommitteeReadinessView,
  buildInstitutionalDecisionNarratives,
} from "@/components/underwrite/committeeReadinessView";
import { EMPTY_RESEARCH_GATE_SNAPSHOT, type ResearchGateSnapshot } from "@/components/underwrite/researchGateTypes";

/**
 * SPEC-CREDIT-MEMO-CONSUME-COMMITTEE-INTELLIGENCE-1 (PR-A)
 * The memo adapter consumes the SAME readiness narratives + blocker model.
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

// OmniCare post-collection: industry source collected (not approved), management
// supported-but-limited, scale fully file-supported but analyst conclusion pending.
function omniEvidence(): any {
  const f = (factor: string, evidenceClass: string) => ({ factor, status: "Supported", evidenceClass, label: `${factor} on file`, reason: "" });
  return {
    privateCompanyEvidenceMode: true,
    scalePlausibilityUnresolved: true,
    scaleFactors: [
      f("Revenue support", "file_supported"),
      f("Loan request / use of proceeds", "file_supported"),
      f("AR / customer concentration", "file_supported"),
      f("Capacity / staffing", "file_supported"),
      f("Collateral support", "file_supported"),
      { factor: "Industry context", status: "Partially supported", evidenceClass: "public_supported", label: "NAICS + industry source", reason: "" },
    ],
    industry: {
      naicsCode: "561422", naicsDescription: "Telemarketing Bureaus and Other Contact Centers",
      understanding: { factor: "Industry understanding", status: "Supported", evidenceClass: "borrower_supported", label: "NAICS + borrower story", reason: "" },
      independentSource: { factor: "Independent industry source", status: "Supported", evidenceClass: "public_supported", label: "Census industry source", reason: "" },
    },
    management: { principals: [{ name: "Matt Hunt", title: "President" }], profilePresent: true, publicVerification: true, adverseStatus: "manual_clear_attested" },
    publicRecords: { attestedClear: true, officialCaptured: false, searchFormOnly: false, status: "manual_clear_attested" },
  };
}

function omniSnapshot(): ResearchGateSnapshot {
  return {
    ...EMPTY_RESEARCH_GATE_SNAPSHOT,
    gatePassed: true,
    preliminaryEligible: true,
    committeeEligible: false,
    committeeBlockerResolutions: [
      blocker({ blocker_id: "mgmt", blocker_type: "management_verification", title: "Management verification", current_status: "present_but_not_committee_grade",
        evidence_tasks: [task({ task_type: "management_attestation", title: "Management profile", status: "collected", resolved_status: "collected" })] }),
      blocker({ blocker_id: "industry", blocker_type: "section_source_gap", title: "Section needs committee-grade sources: Industry Overview", current_status: "present_but_not_committee_grade",
        evidence_tasks: [task({ task_type: "industry_market_source", title: "Industry source", status: "collected", resolved_status: "collected", source_snapshot_id: "snap-1" })] }),
      blocker({ blocker_id: "scale", blocker_type: "contradiction_gap", title: "Contradiction unresolved: scale plausibility", current_status: "missing",
        evidence_tasks: [task({ task_type: "scale_plausibility", title: "Scale plausibility", auto_clear_forbidden: true })] }),
    ],
    committeeBlockers: ["Contradiction check unresolved: scale_plausibility"],
    committeeDecisionEvidence: omniEvidence(),
  } as ResearchGateSnapshot;
}

function buildMemo(snap: ResearchGateSnapshot) {
  const view = buildCommitteeReadinessView(snap)!;
  return buildMemoCommitteeIntelligence({
    narratives: buildInstitutionalDecisionNarratives(snap),
    committeeBlockers: view.committeeBlockers,
    preliminaryReady: snap.preliminaryEligible,
    committeeReady: snap.committeeEligible,
    sources: [{ label: "Census — NAICS 561422", url: "https://data.census.gov/cedsci/all?q=NAICS%20561422", sourceType: "government_data", evidenceClass: "public_supported", reviewState: "needs_review" }],
  });
}

describe("Test 1 — Management memo caveat", () => {
  it("names principal + profile + public verification + manual-adverse limitation, no fully-cleared language", () => {
    const memo = buildMemo(omniSnapshot());
    const md = memo.sections.management.markdown;
    assert.match(md, /Matt Hunt — President/);
    assert.match(md, /management profile.*on file/i);
    assert.match(md, /public verification.*present/i);
    assert.match(md, /manual rather than official|banker-attested/i);
    assert.equal(memo.sections.management.recommendation, "Approve with caveat");
    assert.equal(memo.sections.management.confidence, "Medium");
    assert.doesNotMatch(md, /committee-cleared|fully cleared/i);
  });
});

describe("Test 2 — Industry source collected", () => {
  it("NAICS 561422 + independent source on file + review required; not 'missing'", () => {
    const memo = buildMemo(omniSnapshot());
    const md = memo.sections.industry.markdown;
    assert.match(md, /561422/);
    assert.match(md, /independent committee-grade industry\/market source is on file|independent industry source/i);
    assert.equal(memo.sections.industry.recommendation, "Approve with caveat");
    assert.doesNotMatch(md, /independent .*source is still missing|independent source missing/i);
    // Global blocker copy reflects review-required, not missing.
    assert.ok(memo.committeeReadinessStatus.remainingBlockers.includes("Industry source review required"));
    assert.equal(memo.committeeReadinessStatus.remainingBlockers.includes("Industry support missing"), false);
  });
});

describe("Test 3 — Business Scale cap", () => {
  it("scale supported by file evidence, Approve-with-caveat/Medium, analyst conclusion required; not Approve/High or unable", () => {
    const memo = buildMemo(omniSnapshot());
    const s = memo.sections.scale;
    assert.equal(s.recommendation, "Approve with caveat");
    assert.equal(s.confidence, "Medium");
    assert.match(s.markdown, /supported by file evidence/i);
    assert.match(s.markdown, /analyst scale-plausibility conclusion (is )?still required/i);
    assert.notEqual(s.recommendation, "Approve");
    assert.notEqual(s.recommendation, "Unable to conclude");
    assert.doesNotMatch(s.markdown, /fully cleared|approve \/ high/i);
  });
});

describe("Test 4 — Committee readiness status", () => {
  it("includes the exact remaining blockers + not ready", () => {
    const memo = buildMemo(omniSnapshot());
    assert.equal(memo.committeeReadinessStatus.committeeReady, false);
    const blockers = memo.committeeReadinessStatus.remainingBlockers;
    for (const expected of ["Management support missing", "Industry source review required", "Analyst conclusion missing"]) {
      assert.ok(blockers.includes(expected), `missing blocker: ${expected}`);
    }
    assert.equal(blockers.includes("Industry support missing"), false);
    assert.match(memo.markdown, /Committee review is not ready/);
    assert.match(memo.markdown, /Preliminary underwriting may continue/);
  });
});

describe("Test 5 — Evidence labels", () => {
  it("renders readable labels, not raw enum formatting", () => {
    const memo = buildMemo(omniSnapshot());
    assert.match(memo.markdown, /supported by file evidence/);
    assert.match(memo.markdown, /supported by public source/);
    assert.match(memo.markdown, /banker-attested/);
    // No raw enum spam like "file_supported" / "Supported (file_supported)".
    assert.doesNotMatch(memo.markdown, /file_supported|public_supported|borrower_supported/);
  });
});

describe("Test 6 — no mutation / no source collection (governance)", () => {
  it("the adapter module performs no IO, no collection, no committee mutation", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const src = fs.readFileSync(new URL("../buildMemoCommitteeIntelligence.ts", import.meta.url), "utf8");
    assert.ok(!/server-only/.test(src));
    assert.ok(!/collect-industry-source/.test(src), "must not trigger collection");
    assert.ok(!/supabaseAdmin|createClient|\.from\(|\.insert\(|\.update\(/.test(src), "no DB access");
    assert.equal(/committee_grade_accepted\s*[:=]/.test(src), false, "no committee_grade write");
    assert.ok(!/\bfetch\(/.test(src), "no network");
  });
});
