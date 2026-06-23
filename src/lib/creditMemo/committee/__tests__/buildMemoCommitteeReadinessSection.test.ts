import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildMemoCommitteeReadinessSection } from "../buildMemoCommitteeReadinessSection";
import { EMPTY_RESEARCH_GATE_SNAPSHOT, type ResearchGateSnapshot } from "@/components/underwrite/researchGateTypes";

/**
 * SPEC-CREDIT-MEMO-CONSUME-COMMITTEE-INTELLIGENCE-1 (PR-B)
 * The credit memo's Committee Readiness section consumes the SAME committee
 * model the Committee Readiness panel renders. These tests feed an OmniCare-
 * shaped readiness snapshot (industry source COLLECTED-not-approved, management
 * supported-but-manual-adverse, scale file-supported but analyst conclusion
 * pending) and assert the produced memo section matches the panel materially.
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

function omniSources() {
  return [
    { source_url: "https://data.census.gov/cedsci/all?q=NAICS%20561422", source_type: "government_data", status: "collected", title: "Census NAICS 561422", source_title: "Census — NAICS 561422", reviewed_status: null, credibility_rating: null, connector_kind: "government_data" },
    { source_url: "https://omnicare.example.com", source_type: "borrower_official_website", status: "collected", title: "Borrower website", source_title: null, reviewed_status: null, credibility_rating: null, connector_kind: "manual_url" },
    { source_url: "https://sos.fl.gov/record/123", source_type: "sos_business_registry", status: "collected", title: "FL SOS record", source_title: null, reviewed_status: null, credibility_rating: null, connector_kind: "registry" },
  ];
}

function build() {
  return buildMemoCommitteeReadinessSection(omniSnapshot(), omniSources());
}

describe("PR-B Test 1 — memo includes Committee Readiness section", () => {
  it("renders heading, not-ready status, and the exact remaining blockers", () => {
    const section = build()!;
    assert.ok(section, "section should be produced");
    const md = section.markdown;
    assert.match(md, /Committee Readiness and Evidence Status/);
    assert.match(md, /Not ready for committee review/);
    assert.equal(section.committee_ready, false);
    for (const b of ["Management support missing", "Industry source review required", "Analyst conclusion missing"]) {
      assert.ok(section.remaining_blockers.includes(b), `missing blocker: ${b}`);
      assert.ok(md.includes(b), `markdown missing blocker: ${b}`);
    }
    assert.equal(section.remaining_blockers.includes("Industry support missing"), false);
  });
});

describe("PR-B Test 2 — industry source collected wording", () => {
  it("NAICS 561422 + independent source on file + review-required; never 'missing'", () => {
    const section = build()!;
    const industry = section.decision_support.find((d) => d.group_id === "industry")!;
    assert.match(industry.conclusion, /561422/);
    assert.match(industry.conclusion, /independent committee-grade industry\/market source is on file/i);
    assert.equal(industry.recommendation, "Approve with caveat");
    // review-required surfaced at section level (panel parity), not "missing"
    assert.ok(section.remaining_blockers.includes("Industry source review required"));
    assert.doesNotMatch(section.markdown, /independent .*source is still missing|independent source missing/i);
  });
});

describe("PR-B Test 3 — Business Scale cap", () => {
  it("Approve with caveat / Medium, analyst conclusion still required; not Approve/High or unable", () => {
    const section = build()!;
    const scale = section.decision_support.find((d) => d.group_id === "scale")!;
    assert.equal(scale.recommendation, "Approve with caveat");
    assert.equal(scale.confidence, "Medium");
    assert.match(section.markdown, /Approve with caveat \/ Medium/);
    assert.match(scale.conclusion, /supported by file evidence/i);
    assert.match(scale.conclusion, /analyst scale-plausibility conclusion is still required/i);
    assert.notEqual(scale.recommendation, "Approve");
    assert.notEqual(scale.recommendation, "Unable to conclude");
    assert.doesNotMatch(section.markdown, /Approve \/ High/);
  });
});

describe("PR-B Test 4 — management limitation", () => {
  it("names Matt Hunt / President and flags adverse screen as manual rather than official", () => {
    const section = build()!;
    const mgmt = section.decision_support.find((d) => d.group_id === "management")!;
    assert.equal(mgmt.recommendation, "Approve with caveat");
    assert.equal(mgmt.confidence, "Medium");
    assert.match(mgmt.conclusion, /Matt Hunt/);
    assert.match(mgmt.conclusion, /President/);
    assert.match(section.markdown, /manual rather than official|banker-attested/i);
  });
});

describe("PR-B Test 5 — source coverage", () => {
  it("lists Census source as collected/review-required, never committee-approved", () => {
    const section = build()!;
    const census = section.sources.find((s) => (s.url ?? "").includes("data.census.gov"))!;
    assert.ok(census, "census source listed");
    assert.equal(census.committee_approved, false);
    assert.match(census.review_state ?? "", /collected for review/);
    assert.equal(census.evidence_label, "supported by official source");
    assert.match(section.markdown, /data\.census\.gov/);
    assert.match(section.markdown, /collected for review/);
    assert.doesNotMatch(section.markdown, /committee[- ]approved|committee-grade accepted/i);
  });
});

describe("PR-B Test 6 — governance (no mutation, no collection, no migration/route delta)", () => {
  it("the memo committee modules perform no IO / collection / committee-grade write", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    for (const rel of ["../buildMemoCommitteeReadinessSection.ts", "../loadMemoCommitteeIntelligence.ts"]) {
      const src = fs.readFileSync(new URL(rel, import.meta.url), "utf8");
      assert.ok(!/collect-industry-source/.test(src), `${rel}: must not trigger collection`);
      assert.equal(/committee_grade_accepted\s*[:=]/.test(src), false, `${rel}: no committee_grade write`);
      assert.ok(!/\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(src), `${rel}: no write queries`);
    }
    // The pure section builder performs NO IO at all.
    const pure = fs.readFileSync(new URL("../buildMemoCommitteeReadinessSection.ts", import.meta.url), "utf8");
    assert.ok(!/server-only/.test(pure), "section builder must stay pure (no server-only)");
    assert.ok(!/\bfetch\(|supabaseAdmin|createClient/.test(pure), "section builder must not do IO");
  });
});

describe("PR-B — ready-state status line", () => {
  it("flips to ready wording when committee is eligible", () => {
    const snap = { ...omniSnapshot(), committeeEligible: true } as ResearchGateSnapshot;
    const section = buildMemoCommitteeReadinessSection(snap, [])!;
    assert.equal(section.committee_ready, true);
    assert.match(section.markdown, /Ready for committee review/);
  });
});
