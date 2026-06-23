import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCommitteeBlockerResolutions,
  type CommitteeBlockerResolutionInput,
  type EvidenceRowInput,
} from "@/lib/research/committeeBlockerResolution";
import type { EvidenceQualityResult } from "@/lib/research/evidenceQuality";
import type { SectionSourceStatus } from "@/lib/research/sectionSourceStatus";
import type { ContradictionCheck } from "@/lib/research/contradictionChecklist";

/**
 * SPEC-BIE-EVIDENCE-GRAPH-AND-COMMITTEE-BLOCKER-RESOLUTION-1
 */

const EQ: EvidenceQualityResult = {
  public_web_quality_score: 0.15,
  loan_file_evidence_score: 0.53,
  banker_certified_evidence_score: 0.91,
  certified_evidence_coverage_score: 0.68,
  preliminary_eligible: true,
  committee_eligible: false,
  present_items: ["Legal name on file", "Management profile on file"],
  missing_items: ["DSCR", "Financial statements / tax returns", "Primary/institutional sources"],
  limitations: ["Public web footprint is limited (expected for a private borrower)"],
  strengths: ["Strong banker-certified business context on file"],
  public_web_limited: true,
  private_company_evidence_mode: true,
};

function input(over: Partial<CommitteeBlockerResolutionInput> = {}): CommitteeBlockerResolutionInput {
  return {
    committeeBlockers: [],
    evidenceQuality: EQ,
    sectionSourceStatuses: [],
    contradictionChecklist: [],
    evidenceRows: [],
    subject: { company_name: "OmniCare 365", website: "omnicare365.com" },
    ...over,
  };
}

const mgmtRow: EvidenceRowInput = {
  id: "e1", section: "Management Intelligence", thread_origin: "management",
  evidence_type: "fact", claim: "Matt Hunt is President of OmniCare365 (banker-certified file profile).", confidence: 0.45,
  source_uris: [], source_types: [],
};
const borrowerRow: EvidenceRowInput = {
  id: "e2", section: "Borrower Profile", thread_origin: "borrower",
  evidence_type: "narrative_citation", claim: "OmniCare365 is a Durant, Oklahoma BPO.", confidence: 0.9,
  source_uris: ["https://omnicare365.com"], source_types: ["borrower_official_website"],
};

const get = (rs: ReturnType<typeof buildCommitteeBlockerResolutions>, t: string) =>
  rs.find((r) => r.blocker_type === t)!;

test("[resolution] management blocker → management_verification with linked evidence", () => {
  const rs = buildCommitteeBlockerResolutions(input({
    committeeBlockers: ["Public/attested management verification + adverse screen required"],
    evidenceRows: [mgmtRow, borrowerRow],
  }));
  const m = get(rs, "management_verification");
  assert.ok(m);
  assert.equal(m.current_status, "present_but_not_committee_grade");
  assert.ok(m.existing_supporting_evidence.some((e) => e.section === "Management Intelligence"));
  assert.ok(m.missing_evidence.length > 0);
  assert.ok(m.recommended_actions.length > 0);
  assert.equal(m.requires_public_or_attested_evidence_for_committee, true);
  assert.equal(m.can_be_banker_certified_for_preliminary, true);
});

test("[resolution] source quality blocker → source_quality with institutional source recommendations", () => {
  const rs = buildCommitteeBlockerResolutions(input({
    committeeBlockers: ["Stronger public/institutional sources required"],
    evidenceRows: [borrowerRow],
  }));
  const s = get(rs, "source_quality");
  assert.ok(s.recommended_actions.some((a) => /registry|government|website|trade/i.test(a)));
  assert.ok(s.missing_evidence.some((m) => /primary\/institutional/i.test(m)));
  // links rows that actually carry source_uris
  assert.ok(s.existing_supporting_evidence.some((e) => e.section === "Borrower Profile"));
});

test("[resolution] section source gap maps each deficient section to recommended evidence type", () => {
  const sections: SectionSourceStatus[] = [
    { section: "Market Intelligence", committee_source_status: "warn", preliminary_source_status: "warn", evidence_basis: "loan_file", detail: "needs external" },
  ];
  const rs = buildCommitteeBlockerResolutions(input({
    committeeBlockers: ["Section needs committee-grade sources: Market Intelligence"],
    sectionSourceStatuses: sections,
  }));
  assert.equal(rs.length, 1);
  assert.match(rs[0].acceptable_evidence_examples.join(" "), /BLS|Census|FRED/i);
});

test("[resolution] Management section gap → management_verification type", () => {
  const rs = buildCommitteeBlockerResolutions(input({
    committeeBlockers: ["Section needs committee-grade sources: Management Intelligence"],
  }));
  assert.equal(rs[0].blocker_type, "management_verification");
});

test("[resolution] Litigation section gap → adverse_screen type", () => {
  const rs = buildCommitteeBlockerResolutions(input({
    committeeBlockers: ["Section needs committee-grade sources: Litigation and Risk"],
  }));
  assert.equal(rs[0].blocker_type, "adverse_screen");
});

test("[resolution] evidence coverage blocker lists missing items + existing claims", () => {
  const rs = buildCommitteeBlockerResolutions(input({
    committeeBlockers: ["Evidence coverage below committee threshold"],
    evidenceRows: [mgmtRow, borrowerRow],
  }));
  const c = get(rs, "evidence_coverage");
  assert.deepEqual(c.missing_evidence, EQ.missing_items);
  assert.ok(c.existing_supporting_evidence.length >= 1);
});

test("[resolution] contradiction gap produces action and does NOT auto-clear", () => {
  const checks: ContradictionCheck[] = [
    { check_key: "scale_plausibility", status: "flagged", basis: "Revenue plausibility concern.", severity: "warn", evidence_basis: "loan_file", committee_blocker: true },
  ];
  const rs = buildCommitteeBlockerResolutions(input({
    committeeBlockers: ["Contradiction check unresolved: scale_plausibility"],
    contradictionChecklist: checks,
  }));
  const c = get(rs, "contradiction_gap");
  assert.equal(c.current_status, "partial"); // flagged, not cleared
  assert.ok(c.recommended_actions.some((a) => /do not mark clear/i.test(a)));
  assert.ok(c.acceptable_evidence_examples.length > 0);
});

test("[resolution] no evidence rows → empty existing_supporting_evidence but still actionable", () => {
  const rs = buildCommitteeBlockerResolutions(input({
    committeeBlockers: ["Public/attested management verification + adverse screen required"],
    evidenceRows: [],
  }));
  const m = get(rs, "management_verification");
  assert.equal(m.existing_supporting_evidence.length, 0);
  assert.equal(m.current_status, "missing");
  assert.ok(m.recommended_actions.length > 0); // still produces actions
});

test("[resolution] wrong-entity blocker stays hard — not banker-certifiable", () => {
  const rs = buildCommitteeBlockerResolutions(input({
    committeeBlockers: ["Resolve wrong/conflicting public entity"],
  }));
  const w = get(rs, "other");
  assert.equal(w.can_be_banker_certified_for_preliminary, false);
  assert.equal(w.requires_public_or_attested_evidence_for_committee, true);
});

test("[resolution] never fabricates evidence (only links matching rows)", () => {
  const rs = buildCommitteeBlockerResolutions(input({
    committeeBlockers: ["Section needs committee-grade sources: Industry Overview"],
    evidenceRows: [borrowerRow], // borrower row, not industry
  }));
  // borrower row does not match Industry section/thread → no linked evidence
  assert.equal(rs[0].existing_supporting_evidence.length, 0);
});

test("[resolution] full OmniCare blocker set produces one resolution each, all fields present", () => {
  const omniBlockers = [
    "Stronger public/institutional sources required",
    "Evidence coverage below committee threshold",
    "Section needs committee-grade sources: Management Intelligence",
    "Section needs committee-grade sources: Litigation and Risk",
    "Section needs committee-grade sources: Industry Overview",
    "Section needs committee-grade sources: Market Intelligence",
    "Section needs committee-grade sources: Competitive Landscape",
    "Contradiction check unresolved: scale_plausibility",
  ];
  const rs = buildCommitteeBlockerResolutions(input({
    committeeBlockers: omniBlockers,
    contradictionChecklist: [
      { check_key: "scale_plausibility", status: "flagged", basis: "Revenue plausibility.", severity: "warn", evidence_basis: "loan_file", committee_blocker: true },
    ],
    evidenceRows: [mgmtRow, borrowerRow],
  }));
  assert.equal(rs.length, omniBlockers.length);
  for (const r of rs) {
    assert.ok(r.why_it_blocks_committee.length > 0);
    assert.ok(Array.isArray(r.existing_supporting_evidence));
    assert.ok(r.missing_evidence.length > 0);
    assert.ok(r.recommended_actions.length > 0);
    assert.ok(r.acceptable_evidence_examples.length > 0);
    assert.ok(r.blocker_id.length > 0);
  }
});
