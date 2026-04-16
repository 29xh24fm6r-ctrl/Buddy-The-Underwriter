/**
 * Phase 82 — Evidence Coverage Tests
 *
 * Pure function tests. No DB, no fixtures.
 *
 * Run with:
 *   node --import tsx --test src/lib/research/__tests__/evidenceCoverage.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeEvidenceCoverage } from "../evidenceCoverage.js";

describe("computeEvidenceCoverage", () => {
  it("returns null supportRatio for null input (new deal guard)", () => {
    const r = computeEvidenceCoverage(null);
    assert.equal(r.supportRatio, null);
    assert.equal(r.totalSections, 0);
    assert.equal(r.unsupportedSections, 0);
    assert.equal(r.weakSections, 0);
  });

  it("returns null supportRatio for undefined input", () => {
    const r = computeEvidenceCoverage(undefined);
    assert.equal(r.supportRatio, null);
  });

  it("returns null supportRatio for empty sections array", () => {
    const r = computeEvidenceCoverage({ sections: [] });
    assert.equal(r.supportRatio, null);
    assert.equal(r.totalSections, 0);
  });

  it("all sections supported → ratio = 1", () => {
    const r = computeEvidenceCoverage({
      sections: [
        { section_key: "borrower", claim_ids: [], evidence_count: 5 },
        { section_key: "market", claim_ids: [], evidence_count: 3 },
      ],
    });
    assert.equal(r.supportRatio, 1);
    assert.equal(r.unsupportedSections, 0);
    assert.equal(r.weakSections, 0);
  });

  it("one of two sections unsupported → ratio = 0.5", () => {
    const r = computeEvidenceCoverage({
      sections: [
        { section_key: "borrower", claim_ids: [], evidence_count: 5 },
        { section_key: "management", claim_ids: [], evidence_count: 0 },
      ],
    });
    assert.equal(r.supportRatio, 0.5);
    assert.equal(r.unsupportedSections, 1);
  });

  it("counts weak sections (0 < count < 3) separately from unsupported", () => {
    const r = computeEvidenceCoverage({
      sections: [
        { section_key: "borrower", claim_ids: [], evidence_count: 0 },
        { section_key: "management", claim_ids: [], evidence_count: 1 },
        { section_key: "market", claim_ids: [], evidence_count: 2 },
        { section_key: "competitive", claim_ids: [], evidence_count: 3 },
        { section_key: "industry", claim_ids: [], evidence_count: 10 },
      ],
    });
    assert.equal(r.totalSections, 5);
    assert.equal(r.unsupportedSections, 1);
    assert.equal(r.weakSections, 2);
    assert.equal(r.supportRatio, 0.8);
  });

  it("weak threshold is strict inequality: count=3 is NOT weak", () => {
    const r = computeEvidenceCoverage({
      sections: [{ section_key: "x", claim_ids: [], evidence_count: 3 }],
    });
    assert.equal(r.weakSections, 0);
  });

  it("handles malformed section missing evidence_count", () => {
    const r = computeEvidenceCoverage({
      sections: [
        { section_key: "x", claim_ids: [] } as any,
        { section_key: "y", claim_ids: [], evidence_count: 5 },
      ],
    });
    // missing count treated as 0 → unsupported
    assert.equal(r.unsupportedSections, 1);
    assert.equal(r.supportRatio, 0.5);
  });

  it("gate threshold boundary: ratio = 0.85 does not trigger downgrade", () => {
    // Gate 9: downgrade when ratio < 0.85. Simulate 17/20 supported.
    const sections = Array.from({ length: 20 }, (_, i) => ({
      section_key: `s${i}`,
      claim_ids: [],
      evidence_count: i < 17 ? 5 : 0,
    }));
    const r = computeEvidenceCoverage({ sections });
    assert.equal(r.supportRatio, 0.85);
  });
});
