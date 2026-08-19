import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);
const { evaluateTridentRelease } = require("../tridentReleaseGate") as typeof import("../tridentReleaseGate");

function release(overrides: Record<string, unknown> = {}) {
  return evaluateTridentRelease({
    businessPlanVerdict: "pass",
    feasibilityVerdict: "pass",
    feasibilityCompleteness: 0.9,
    feasibilityCitationCount: 3,
    projectionsNarrative: Array.from({ length: 40 }, () => "word").join(" "),
    sourcesAndUses: { balanced: true, imbalance: 0 },
    memoId: "memo-1",
    memoInputHash: "hash-1",
    expectedMemoInputHash: "hash-1",
    memoResearchTrustGrade: "committee_grade",
    spreadId: "spread-1",
    spreadReady: true,
    spreadHasIntegrityHash: true,
    spreadHasCanonicalFactsTimestamp: true,
    artifactPaths: ["plan.pdf", "projections.xlsx", "feasibility.pdf"],
    isTestDeal: false,
    ...overrides,
  });
}

test("passes only a complete run-bound institutional release", () => {
  assert.deepEqual(release(), { ok: true, reasons: [], warnings: [] });
});

test("blocks stale memo and unreconciled sources and uses", () => {
  const result = release({
    memoInputHash: "old-hash",
    sourcesAndUses: { balanced: false, imbalance: 150000 },
  });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("canonical_credit_memo_stale"));
  assert.ok(result.reasons.includes("sources_and_uses_not_reconciled"));
});

test("accepts private-company preliminary research with a lender-review warning", () => {
  const result = release({ memoResearchTrustGrade: "preliminary" });
  assert.equal(result.ok, true);
  assert.ok(result.warnings.includes("memo_research_preliminary_requires_lender_review"));
});

test("blocks missing or non-reviewable research on real deals", () => {
  const result = release({ memoResearchTrustGrade: null });
  assert.equal(result.ok, false);
  assert.ok(result.reasons.includes("memo_research_not_release_ready"));
});

test("allows synthetic QA commissioning without fabricated public research or citations", () => {
  const result = release({
    isTestDeal: true,
    memoResearchTrustGrade: null,
    feasibilityCitationCount: 0,
  });
  assert.equal(result.ok, true);
  assert.ok(result.warnings.includes("synthetic_qa_deal_has_no_public_research_grade"));
  assert.ok(result.warnings.includes("synthetic_qa_citation_coverage_below_three_sections"));
});
