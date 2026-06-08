import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildCommitteeSourceCollectionPlan,
  type SourceCollectionInput,
} from "../sourceCollectionPlan";

/**
 * SPEC-BIE-ACTIVE-SOURCE-COLLECTION-PR-A — pure source-collection planning.
 * No fetch, no fabricated URLs; identifies the independent industry source
 * OmniCare still needs.
 */

function omni(over: Partial<SourceCollectionInput> = {}): SourceCollectionInput {
  return {
    dealId: "dc52c626",
    generatedAt: "2026-06-08T00:00:00Z",
    legalName: "OmniCare LLC",
    website: "https://omnicare.example",
    hqState: "Oklahoma",
    naicsCode: "561422",
    naicsDescription: "Telemarketing Bureaus and Other Contact Centers",
    businessDescription: "BPO / call center",
    customers: "national enterprise / healthcare customers",
    privateCompanyEvidenceMode: true,
    currentCommitteeTasks: [],
    currentSourceSnapshots: [],
    currentDecisionEvidence: null,
    ...over,
  };
}
const industry = (p: ReturnType<typeof buildCommitteeSourceCollectionPlan>) =>
  p.targets.find((t) => t.decisionArea === "Industry Validation")!;

describe("OmniCare industry gap creates a source target", () => {
  it("one high-priority Industry Validation target with BLS+Census collectors", () => {
    const t = industry(buildCommitteeSourceCollectionPlan(omni()));
    assert.equal(t.priority, "high");
    assert.equal(t.status, "planned");
    assert.equal(t.blockerType, "independent_industry_source_missing");
    assert.ok(t.recommendedCollectors.includes("bls_naics_industry"));
    assert.ok(t.recommendedCollectors.includes("census_naics_industry"));
    assert.match(t.requiredEvidenceClass, /official_supported|public_supported/);
    assert.equal(t.idempotencyKey, "industry_validation:naics:561422");
    assert.equal(t.searchInputs.naicsCode, "561422");
  });
});

describe("borrower website / SOS do not satisfy industry source", () => {
  it("industry target is still created when only website + SOS exist", () => {
    const t = industry(buildCommitteeSourceCollectionPlan(omni({
      currentSourceSnapshots: [
        { source_type: "borrower_website", status: "collected" },
        { source_type: "sos_business_registry", status: "collected" },
      ],
    })));
    assert.equal(t.priority, "high");
    assert.equal(t.status, "planned");
  });
});

describe("existing government industry source suppresses duplicate target", () => {
  it("no high-priority duplicate; status review_existing_source", () => {
    const t = industry(buildCommitteeSourceCollectionPlan(omni({
      currentSourceSnapshots: [{ source_type: "government_industry_data", status: "collected" }],
    })));
    assert.notEqual(t.priority, "high");
    assert.ok(t.status === "review_existing_source" || t.status === "already_collected");
  });

  it("also suppresses when decision-evidence already shows an independent source", () => {
    const t = industry(buildCommitteeSourceCollectionPlan(omni({
      currentDecisionEvidence: { industry: { independentSource: { status: "Supported" } } } as any,
    })));
    assert.notEqual(t.priority, "high");
  });
});

describe("national borrower makes local geography optional", () => {
  it("local geography limitation + national context prioritized", () => {
    const t = industry(buildCommitteeSourceCollectionPlan(omni()));
    assert.equal(t.searchInputs.geography, "national first, local optional");
    assert.ok(t.limitations.some((l) => /national enterprise customer profile/i.test(l)));
    assert.ok(t.acceptanceRules.some((r) => /local geography is optional/i.test(r)));
  });
});

describe("no hallucinated URLs", () => {
  it("targets carry source families + collector IDs, never fabricated URLs", () => {
    const t = industry(buildCommitteeSourceCollectionPlan(omni()));
    const blob = JSON.stringify(t);
    assert.ok(t.sourceFamilies.length > 0 && t.recommendedCollectors.length > 0);
    assert.equal(/https?:\/\/(?!omnicare\.example)/.test(blob), false, "no fabricated external URLs");
  });
});

describe("private-company mode wording", () => {
  it("limitations mention private footprint; still requests independent support", () => {
    const t = industry(buildCommitteeSourceCollectionPlan(omni({ privateCompanyEvidenceMode: true })));
    assert.ok(t.limitations.some((l) => /private company public footprint/i.test(l)));
    assert.equal(t.status, "planned");
    assert.equal(t.priority, "high");
  });
});

describe("links to an existing industry task instead of duplicating", () => {
  it("sets linkedTaskId when an industry_market_source task exists", () => {
    const t = industry(buildCommitteeSourceCollectionPlan(omni({
      currentCommitteeTasks: [{ id: "task-123", task_type: "industry_market_source" }],
    })));
    assert.equal(t.linkedTaskId, "task-123");
  });
});
