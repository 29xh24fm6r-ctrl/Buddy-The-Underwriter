/**
 * Phase 82 — applyMemoEvidenceGate + downgradeTrust Tests
 *
 * Run with:
 *   node --import tsx --test src/lib/research/__tests__/memoEvidenceGate.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyMemoEvidenceGate,
  downgradeTrust,
  EVIDENCE_COVERAGE_THRESHOLD,
  CONTRADICTION_STRENGTH_THRESHOLD,
} from "../completionGate.js";

describe("downgradeTrust", () => {
  it("downgrades when floor is strictly lower", () => {
    assert.equal(downgradeTrust("committee_grade", "preliminary"), "preliminary");
  });

  it("does NOT downgrade when floor is equal", () => {
    assert.equal(downgradeTrust("preliminary", "preliminary"), "preliminary");
  });

  it("does NOT downgrade when floor is higher (never upgrades)", () => {
    assert.equal(downgradeTrust("preliminary", "committee_grade"), "preliminary");
  });

  it("research_failed floors everything", () => {
    assert.equal(
      downgradeTrust("committee_grade", "research_failed"),
      "research_failed",
    );
  });
});

describe("applyMemoEvidenceGate — new-deal guard", () => {
  it("null support ratio does NOT downgrade", () => {
    const r = applyMemoEvidenceGate("committee_grade", {
      evidenceSupportRatio: null,
      contradictionStrongRatio: null,
    });
    assert.equal(r.trustGrade, "committee_grade");
    assert.equal(r.downgraded, false);
    assert.deepEqual(r.reasons, []);
  });
});

describe("applyMemoEvidenceGate — Gate 9 (Evidence Coverage)", () => {
  it("ratio >= threshold preserves committee_grade", () => {
    const r = applyMemoEvidenceGate("committee_grade", {
      evidenceSupportRatio: EVIDENCE_COVERAGE_THRESHOLD,
      contradictionStrongRatio: 1,
    });
    assert.equal(r.trustGrade, "committee_grade");
    assert.equal(r.downgraded, false);
  });

  it("ratio just below threshold downgrades committee_grade → preliminary", () => {
    const r = applyMemoEvidenceGate("committee_grade", {
      evidenceSupportRatio: 0.84,
      contradictionStrongRatio: 1,
    });
    assert.equal(r.trustGrade, "preliminary");
    assert.equal(r.downgraded, true);
    assert.ok(r.reasons.some((x) => x.startsWith("evidence_coverage")));
  });

  it("Gate 9 does not upgrade already-lower grades", () => {
    const r = applyMemoEvidenceGate("manual_review_required", {
      evidenceSupportRatio: 0.5,
      contradictionStrongRatio: 1,
    });
    assert.equal(r.trustGrade, "manual_review_required");
  });
});

describe("applyMemoEvidenceGate — Gate 10 (Contradiction Strength)", () => {
  it("ratio >= threshold preserves trust", () => {
    const r = applyMemoEvidenceGate("committee_grade", {
      evidenceSupportRatio: 1,
      contradictionStrongRatio: CONTRADICTION_STRENGTH_THRESHOLD,
    });
    assert.equal(r.trustGrade, "committee_grade");
  });

  it("ratio below threshold downgrades to manual_review_required", () => {
    const r = applyMemoEvidenceGate("committee_grade", {
      evidenceSupportRatio: 1,
      contradictionStrongRatio: 0.5,
    });
    assert.equal(r.trustGrade, "manual_review_required");
    assert.ok(r.reasons.some((x) => x.startsWith("contradiction_strength")));
  });

  it("null strong ratio → no downgrade (absent data guard)", () => {
    const r = applyMemoEvidenceGate("committee_grade", {
      evidenceSupportRatio: 1,
      contradictionStrongRatio: null,
    });
    assert.equal(r.trustGrade, "committee_grade");
  });
});

describe("applyMemoEvidenceGate — combined", () => {
  it("both gates fail: floors to manual_review_required (strictest)", () => {
    const r = applyMemoEvidenceGate("committee_grade", {
      evidenceSupportRatio: 0.5,
      contradictionStrongRatio: 0.3,
    });
    assert.equal(r.trustGrade, "manual_review_required");
    assert.equal(r.reasons.length, 2);
  });

  it("never upgrades research_failed", () => {
    const r = applyMemoEvidenceGate("research_failed", {
      evidenceSupportRatio: 1,
      contradictionStrongRatio: 1,
    });
    assert.equal(r.trustGrade, "research_failed");
  });
});
