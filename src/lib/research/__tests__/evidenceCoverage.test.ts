import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

// evidenceCoverage.ts imports "server-only" (transitively via supabaseAdmin) —
// redirect to the repo stub before requiring the runtime exports.
mockServerOnly();
const require_ = createRequire(import.meta.url);
const { computeEvidenceCoverageFromTrace } =
  require_("@/lib/research/evidenceCoverage") as typeof import("@/lib/research/evidenceCoverage");

/**
 * Regression coverage for specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md P1:
 * this module previously had NO test file at all, despite gating
 * committee_grade at an 85% supportRatio threshold. Of particular concern:
 * claimLedger.ts persists Credit Thesis / Contradictions / Underwriting
 * Questions claims with source_uris ALWAYS empty by construction — a
 * mission where every research thread failed but synthesis still ran could
 * previously still compute a HIGH supportRatio from those zero-source rows,
 * because buildResearchTrace's evidence_count counted raw row length, not
 * sourced-claim count. That's now fixed upstream (memoEvidenceResolver.ts);
 * these tests pin the aggregation logic here.
 */

test("[coverage] null/missing trace returns null", () => {
  assert.equal(computeEvidenceCoverageFromTrace(null), null);
  assert.equal(computeEvidenceCoverageFromTrace(undefined), null);
  assert.equal(computeEvidenceCoverageFromTrace({ sections: [] }), null);
});

test("[coverage] all sections sourced → supportRatio 1.0", () => {
  const r = computeEvidenceCoverageFromTrace({
    sections: [
      { section_key: "industry_overview", claim_ids: ["a"], evidence_count: 3 },
      { section_key: "borrower_profile", claim_ids: ["b"], evidence_count: 1 },
    ],
  });
  assert.ok(r);
  assert.equal(r!.totalSections, 2);
  assert.equal(r!.supportedSections, 2);
  assert.equal(r!.unsupportedSections, 0);
  assert.equal(r!.supportRatio, 1);
});

test("[coverage] zero-evidence sections are unsupported, not silently counted", () => {
  const r = computeEvidenceCoverageFromTrace({
    sections: [
      { section_key: "industry_overview", claim_ids: [], evidence_count: 0 },
      { section_key: "borrower_profile", claim_ids: [], evidence_count: 0 },
    ],
  });
  assert.ok(r);
  assert.equal(r!.supportedSections, 0);
  assert.equal(r!.supportRatio, 0);
});

// The exact scenario the audit flagged: every research thread failed
// (evidence_count is already zero-source-filtered upstream), but synthesis
// still produced Credit Thesis / Contradictions / Underwriting Questions
// sections. Those must show as unsupported here, not inflate the ratio.
test("[coverage] mission with only zero-source synthesis claims scores low, not high", () => {
  const r = computeEvidenceCoverageFromTrace({
    sections: [
      { section_key: "credit_thesis", claim_ids: ["t1"], evidence_count: 0, total_claim_count: 1 },
      { section_key: "contradictions", claim_ids: ["c1"], evidence_count: 0, total_claim_count: 1 },
      { section_key: "underwriting_questions", claim_ids: ["q1"], evidence_count: 0, total_claim_count: 1 },
      { section_key: "borrower_profile", claim_ids: [], evidence_count: 0, total_claim_count: 0 },
    ],
  });
  assert.ok(r);
  assert.equal(r!.supportRatio, 0, "zero-source claims must not count as supported evidence");
  assert.ok(r!.supportRatio < 0.85, "must not clear the committee_grade coverage threshold");
});

test("[coverage] mixed sections compute the correct partial ratio", () => {
  const r = computeEvidenceCoverageFromTrace({
    sections: [
      { section_key: "a", claim_ids: ["1"], evidence_count: 2 },
      { section_key: "b", claim_ids: [], evidence_count: 0 },
      { section_key: "c", claim_ids: ["2"], evidence_count: 1 },
      { section_key: "d", claim_ids: [], evidence_count: 0 },
    ],
  });
  assert.ok(r);
  assert.equal(r!.totalSections, 4);
  assert.equal(r!.supportedSections, 2);
  assert.equal(r!.supportRatio, 0.5);
});
