import test from "node:test";
import assert from "node:assert/strict";

import {
  generateCommitteeEvidenceTaskSpecs,
  taskTypeSet,
} from "@/lib/research/committeeEvidenceTasks";
import type { CommitteeBlockerResolution } from "@/lib/research/committeeBlockerResolution";

/**
 * SPEC-BIE-SOURCE-SNAPSHOT-LEDGER-AND-OFFICIAL-SOURCE-CONNECTORS-1
 */

function res(over: Partial<CommitteeBlockerResolution>): CommitteeBlockerResolution {
  return {
    blocker_id: over.blocker_id ?? "b",
    title: over.title ?? "t",
    blocker_type: over.blocker_type ?? "other",
    severity: "committee_blocker",
    current_status: "partial",
    why_it_blocks_committee: "",
    existing_supporting_evidence: [],
    missing_evidence: [],
    recommended_actions: [],
    acceptable_evidence_examples: [],
    can_be_banker_certified_for_preliminary: true,
    requires_public_or_attested_evidence_for_committee: true,
    ...over,
  };
}

// The real OmniCare b86df09c committee blocker set.
const OMNICARE: CommitteeBlockerResolution[] = [
  res({ blocker_id: "src", blocker_type: "source_quality", title: "Stronger public/institutional sources required" }),
  res({ blocker_id: "cov", blocker_type: "evidence_coverage", title: "Evidence coverage below committee threshold" }),
  res({ blocker_id: "mgmt", blocker_type: "management_verification", title: "Section needs committee-grade sources: Management Intelligence" }),
  res({ blocker_id: "lit", blocker_type: "adverse_screen", title: "Section needs committee-grade sources: Litigation and Risk" }),
  res({ blocker_id: "ind", blocker_type: "section_source_gap", title: "Section needs committee-grade sources: Industry Overview" }),
  res({ blocker_id: "mkt", blocker_type: "section_source_gap", title: "Section needs committee-grade sources: Market Intelligence" }),
  res({ blocker_id: "comp", blocker_type: "section_source_gap", title: "Section needs committee-grade sources: Competitive Landscape" }),
  res({ blocker_id: "scale", blocker_type: "contradiction_gap", title: "Contradiction unresolved: scale plausibility" }),
];

const SUBJECT = { company_name: "OmniCare 365", website: "omnicare365.com", naics_code: "561422" };

test("[tasks] OmniCare blocker set produces all 6 acceptance task types", () => {
  const specs = generateCommitteeEvidenceTaskSpecs(OMNICARE, SUBJECT);
  const types = taskTypeSet(specs);
  for (const t of [
    "borrower_website_snapshot",
    "sos_business_registry",
    "public_adverse_screen",
    "management_attestation",
    "industry_market_source",
    "competitive_source",
  ]) {
    assert.ok(types.includes(t as any), `missing task type ${t}`);
  }
});

test("[tasks] borrower website task is auto-collectible with the subject website as target_url", () => {
  const specs = generateCommitteeEvidenceTaskSpecs(OMNICARE, SUBJECT);
  const web = specs.find((s) => s.task_type === "borrower_website_snapshot")!;
  assert.equal(web.auto_collectible, true);
  assert.equal(web.target_url, "omnicare365.com");
});

test("[tasks] every spec links to a blocker_id; only website is auto-collectible", () => {
  const specs = generateCommitteeEvidenceTaskSpecs(OMNICARE, SUBJECT);
  for (const s of specs) {
    assert.ok(s.blocker_id.length > 0);
    assert.equal(s.auto_collectible, s.task_type === "borrower_website_snapshot");
  }
});

test("[tasks] industry task references the NAICS code", () => {
  const specs = generateCommitteeEvidenceTaskSpecs(OMNICARE, SUBJECT);
  const ind = specs.find((s) => s.task_type === "industry_market_source")!;
  assert.match(ind.instructions, /561422/);
});

test("[tasks] deduped by (blocker_id, task_type)", () => {
  const specs = generateCommitteeEvidenceTaskSpecs(OMNICARE, SUBJECT);
  const keys = specs.map((s) => `${s.blocker_id}::${s.task_type}`);
  assert.equal(keys.length, new Set(keys).size);
});

test("[tasks] management blocker yields attestation + adverse screen", () => {
  const specs = generateCommitteeEvidenceTaskSpecs(
    [res({ blocker_id: "mgmt", blocker_type: "management_verification", title: "mgmt" })],
    SUBJECT,
  );
  const types = specs.map((s) => s.task_type).sort();
  assert.deepEqual(types, ["management_attestation", "public_adverse_screen"].sort());
});

test("[tasks] wrong-entity (other) → manual_review only", () => {
  const specs = generateCommitteeEvidenceTaskSpecs(
    [res({ blocker_id: "x", blocker_type: "other", title: "Resolve wrong/conflicting public entity" })],
    SUBJECT,
  );
  assert.deepEqual(specs.map((s) => s.task_type), ["manual_review"]);
});

test("[tasks] no website on file → borrower website task has null target_url (still generated)", () => {
  const specs = generateCommitteeEvidenceTaskSpecs(OMNICARE, { company_name: "X", website: null, naics_code: null });
  const web = specs.find((s) => s.task_type === "borrower_website_snapshot")!;
  assert.equal(web.target_url, null);
});
