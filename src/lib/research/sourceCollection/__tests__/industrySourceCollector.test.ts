import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildIndustrySourceDescriptor } from "../industrySourceCollector";

/** SPEC-BIE-ACTIVE-SOURCE-COLLECTION-PR-B — deterministic industry collector. */

describe("buildIndustrySourceDescriptor", () => {
  it("builds a deterministic government-data source for OmniCare NAICS 561422", () => {
    const d = buildIndustrySourceDescriptor({ naicsCode: "561422", naicsDescription: "Telemarketing Bureaus and Other Contact Centers", hqState: "Oklahoma" })!;
    assert.equal(d.connectorKind, "trade_or_market_source");
    assert.equal(d.sourceType, "government_data");
    assert.match(d.sourceUrl, /^https:\/\/(data\.census\.gov|data\.bls\.gov)/);
    assert.match(d.sourceUrl, /561422/);
    assert.equal(d.candidateMetadata.decision_area, "Industry Validation");
    assert.equal(d.candidateMetadata.naics_code, "561422");
    assert.equal(d.candidateMetadata.idempotency_key, "industry_validation:naics:561422");
    assert.equal(d.candidateMetadata.review_required, true);
    assert.equal(d.candidateMetadata.requested_evidence_class, "official_supported");
  });

  it("returns null when there is no usable NAICS (never fabricates a source)", () => {
    assert.equal(buildIndustrySourceDescriptor({ naicsCode: null }), null);
    assert.equal(buildIndustrySourceDescriptor({ naicsCode: "999999" }), null);
    assert.equal(buildIndustrySourceDescriptor({ naicsCode: "abc" }), null);
  });

  it("does not invent URLs — uses only the planner's deterministic government URLs", () => {
    const d = buildIndustrySourceDescriptor({ naicsCode: "561422" })!;
    assert.match(d.sourceUrl, /census\.gov|bls\.gov/);
  });
});
