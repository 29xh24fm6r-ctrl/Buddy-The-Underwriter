import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildDecisionEvidenceProjection,
  buildResearchFactProjection,
  type EvidenceProjectionInput,
} from "../committeeEvidenceProjection";

/**
 * SPEC-BIE-DERIVATION-AUDIT-AND-EVIDENCE-PROMOTION-1 — evidence promotion +
 * classification. Pure projection from already-loaded deal data; no fabrication.
 */

function inp(over: Partial<EvidenceProjectionInput> = {}): EvidenceProjectionInput {
  return {
    financialFactKeys: [],
    borrowerStory: null,
    loan: null,
    managementProfiles: [],
    naicsCode: null,
    naicsDescription: null,
    sourceSnapshots: [],
    committeeTasks: [],
    privateCompanyEvidenceMode: false,
    ...over,
  };
}
const scale = (p: ReturnType<typeof buildDecisionEvidenceProjection>, f: string) =>
  p.scaleFactors.find((x) => x.factor === f)!;

describe("Business Scale evidence promotion", () => {
  it("a revenue fact promotes revenue support to file_supported", () => {
    const f = scale(buildDecisionEvidenceProjection(inp({ financialFactKeys: ["TOTAL_REVENUE", "NET_INCOME"] })), "Revenue support");
    assert.equal(f.status, "Supported");
    assert.equal(f.evidenceClass, "file_supported");
  });

  it("borrower customer_concentration promotes AR/concentration to borrower_supported (not missing)", () => {
    const f = scale(buildDecisionEvidenceProjection(inp({ borrowerStory: { customer_concentration: "Top 3 customers ~60% of revenue" } })), "AR / customer concentration");
    assert.equal(f.status, "Partially supported");
    assert.equal(f.evidenceClass, "borrower_supported");
  });

  it("an AR fact promotes AR/concentration to file_supported", () => {
    const f = scale(buildDecisionEvidenceProjection(inp({ financialFactKeys: ["AR_SCH_L"] })), "AR / customer concentration");
    assert.equal(f.evidenceClass, "file_supported");
  });

  it("growth_strategy promotes capacity to borrower_supported (not missing)", () => {
    const f = scale(buildDecisionEvidenceProjection(inp({ borrowerStory: { growth_strategy: "Hiring 20 agents; new site Q3" } })), "Capacity / staffing");
    assert.equal(f.evidenceClass, "borrower_supported");
    assert.equal(f.status, "Partially supported");
  });

  it("capacity is not_derivable (not 'Missing') when no fact or narrative exists", () => {
    const f = scale(buildDecisionEvidenceProjection(inp()), "Capacity / staffing");
    assert.equal(f.status, "Not derivable");
    assert.equal(f.evidenceClass, "not_derivable");
  });

  it("a collateral collected item promotes collateral to file_supported", () => {
    const f = scale(buildDecisionEvidenceProjection(inp({ committeeTasks: [{ collected_items: ["Collateral schedule on file"] }] })), "Collateral support");
    assert.equal(f.evidenceClass, "file_supported");
  });

  it("missing loan request keeps the loan factor missing", () => {
    const f = scale(buildDecisionEvidenceProjection(inp()), "Loan request / use of proceeds");
    assert.equal(f.status, "Missing");
    assert.equal(f.evidenceClass, "missing");
  });

  it("a structured loan request promotes loan factor to file_supported", () => {
    const f = scale(buildDecisionEvidenceProjection(inp({ loan: { product_type: "Term loan", requested_amount: 2_000_000 } })), "Loan request / use of proceeds");
    assert.equal(f.evidenceClass, "file_supported");
  });
});

describe("Industry: understanding vs independent-source gap", () => {
  it("NAICS + borrower story create industry understanding while institutional source stays missing", () => {
    const p = buildDecisionEvidenceProjection(inp({ naicsCode: "561422", naicsDescription: "Telemarketing Bureaus", borrowerStory: { business_description: "BPO / call center", competitive_position: "Regional leader" } }));
    assert.equal(p.industry.understanding.status, "Supported");
    assert.equal(p.industry.understanding.evidenceClass, "borrower_supported");
    assert.equal(p.industry.independentSource.status, "Missing");
    assert.equal(p.industry.naicsCode, "561422");
  });

  it("a recognized industry source snapshot promotes independent support to public_supported", () => {
    const p = buildDecisionEvidenceProjection(inp({ naicsCode: "561422", sourceSnapshots: [{ source_type: "census_industry", status: "collected" }] }));
    assert.equal(p.industry.independentSource.evidenceClass, "public_supported");
  });
});

describe("Management projection", () => {
  it("names principals and reflects validation pass", () => {
    const p = buildDecisionEvidenceProjection(inp({ managementProfiles: [{ person_name: "Matt Hunt", title: "CEO" }], managementValidationPass: true, principalsConfirmed: 1 }));
    assert.equal(p.management.principals[0].name, "Matt Hunt");
    assert.equal(p.management.profilePresent, true);
    assert.equal(p.management.publicVerification, true);
  });
});

describe("Public Records / adverse classification", () => {
  it("banker-attested clear is manual_clear_attested, not official", () => {
    const p = buildDecisionEvidenceProjection(inp({ committeeTasks: [{ task_type: "public_adverse_screen", review_status: "banker_attested", review_reason: "screening_result:clear" }] }));
    assert.equal(p.publicRecords.status, "manual_clear_attested");
    assert.equal(p.publicRecords.attestedClear, true);
    assert.equal(p.publicRecords.officialCaptured, false);
  });

  it("an official capture outranks an attestation", () => {
    const p = buildDecisionEvidenceProjection(inp({ committeeTasks: [{ task_type: "public_adverse_screen", official_capture_available: true }] }));
    assert.equal(p.publicRecords.status, "official_captured");
  });

  it("a search-form-only capture is flagged, not treated as official", () => {
    const p = buildDecisionEvidenceProjection(inp({ committeeTasks: [{ task_type: "public_adverse_screen", official_capture_status: "search_form_only" }] }));
    assert.equal(p.publicRecords.status, "search_form_only");
    assert.equal(p.publicRecords.officialCaptured, false);
  });
});

describe("Private-company evidence mode", () => {
  it("passes the flag through and labels the independent-source gap as expected for a private borrower", () => {
    const p = buildDecisionEvidenceProjection(inp({ privateCompanyEvidenceMode: true, naicsCode: "561422" }));
    assert.equal(p.privateCompanyEvidenceMode, true);
    assert.match(p.industry.independentSource.reason, /private borrower/i);
  });
});

describe("Research fact projection (J)", () => {
  it("OmniCare-shaped input yields a non-empty fact projection with provenance + confidence", () => {
    const { facts } = buildResearchFactProjection(inp({
      naicsCode: "561422",
      naicsDescription: "Telemarketing Bureaus and Other Contact Centers",
      borrowerStory: { legal_name: "OmniCare LLC", customer_concentration: "Top 3 ~60%", growth_strategy: "Expand", business_description: "BPO" },
      financialFactKeys: ["TOTAL_REVENUE", "DSCR"],
      managementProfiles: [{ person_name: "Matt Hunt", title: "CEO" }],
      loan: { product_type: "Term loan", requested_amount: 2_000_000 },
    }));
    assert.ok(facts.length >= 6, `expected facts, got ${facts.length}`);
    assert.ok(facts.every((f) => f.source && f.confidence > 0), "facts carry provenance + confidence");
    assert.ok(facts.some((f) => f.key === "naics_code" && f.value === "561422"));
    assert.ok(facts.some((f) => f.key === "principal_name" && /Matt Hunt/.test(f.value)));
    assert.ok(facts.some((f) => f.key === "revenue_latest"));
  });

  it("does not fabricate facts when inputs are empty", () => {
    const { facts } = buildResearchFactProjection(inp());
    assert.ok(facts.every((f) => f.source && f.confidence > 0));
    assert.equal(facts.some((f) => f.key === "naics_code"), false);
  });
});
