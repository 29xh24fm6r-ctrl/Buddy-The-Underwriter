import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
import type { BIEResult } from "@/lib/research/buddyIntelligenceEngine";

/**
 * Regression for specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md (round 4):
 * extractBieThreadResults() is what makes BIE resumable — it must pull the
 * exact same {result, sourceUrls, segments, diagnostic} shape for every
 * thread that runBuddyIntelligenceEngine()'s previousThreadResults param
 * expects, or a "successful" resume would silently reuse garbage.
 */

mockServerOnly();
const require_ = createRequire(import.meta.url);
const { extractBieThreadResults } =
  require_("@/lib/research/runMission") as typeof import("@/lib/research/runMission");

function bie(): BIEResult {
  const emptyThreadMap = { entity_lock: [], borrower: [], management: [], competitive: [], market: [], industry: [], transaction: [] };
  const okDiag = (thread: string) => ({ thread, ok: true, error_type: "none", prompt_chars: 10, source_count: 1, model: "m", created_at: "t" }) as any;
  const failDiag = (thread: string) => ({ thread, ok: false, error_type: "network_error", prompt_chars: 10, source_count: 0, model: "m", created_at: "t" }) as any;
  return {
    entity_lock: { confirmed_name: "Acme", confirmed_location: "TX", confirmed_industry: "x", entity_confidence: 0.9, disambiguation_notes: "", alternative_entities_found: [], research_scope: "", entity_classification: "probable_private_entity" },
    entity_confirmed: true,
    entity_confidence: 0.9,
    entity_classification: "probable_private_entity",
    borrower: { entity_confirmation: "x", entity_confidence: 0.9, company_overview: "x", reputation_and_reviews: "x", recent_news: "x", litigation_and_risk: "x", digital_presence: "x", customer_base_and_reach: "x", trend_direction: "stable" },
    management: null,
    management_basis: null,
    competitive: null,
    market: null,
    industry: null,
    transaction: null,
    synthesis: { executive_credit_thesis: "x", repayment_strengths: [], core_vulnerabilities: [], opportunities: [], threats: [], structure_implications: [], underwriting_questions: [], approval_conditions: [], monitoring_triggers: [], three_year_outlook: "x", five_year_outlook: "x", contradictions_and_uncertainties: [], evidence_quality_summary: "x", research_quality_score: "Moderate", entity_validation_passed: true, management_profiles_validated: true, validation_notes: "" },
    research_quality: "partial",
    sources_used: ["https://acme.com"],
    thread_sources: { ...emptyThreadMap, entity_lock: ["https://acme.com"], borrower: ["https://acme.com/about"] },
    thread_segments: { ...emptyThreadMap },
    thread_diagnostics: {
      entity_lock: okDiag("entity_lock"),
      borrower: okDiag("borrower"),
      management: failDiag("management"),
      competitive: failDiag("competitive"),
      market: failDiag("market"),
      industry: failDiag("industry"),
      transaction: failDiag("transaction"),
      synthesis: okDiag("synthesis"),
    },
    compiled_at: "2026-07-13T00:00:00Z",
  };
}

test("extracts every thread's result/sourceUrls/segments/diagnostic", () => {
  const fixture = bie();
  const cache = extractBieThreadResults(fixture);
  assert.equal(cache.entity_lock?.result, fixture.entity_lock);
  assert.deepEqual(cache.entity_lock?.sourceUrls, ["https://acme.com"]);
  assert.equal(cache.entity_lock?.diagnostic.ok, true);

  assert.deepEqual(cache.borrower?.sourceUrls, ["https://acme.com/about"]);
  assert.equal(cache.borrower?.diagnostic.ok, true);

  assert.equal(cache.management?.result, null);
  assert.equal(cache.management?.diagnostic.ok, false);
});

test("synthesis has no external sources of its own (always empty urls/segments)", () => {
  const cache = extractBieThreadResults(bie());
  assert.deepEqual(cache.synthesis?.sourceUrls, []);
  assert.deepEqual(cache.synthesis?.segments, []);
  assert.equal(cache.synthesis?.diagnostic.ok, true);
});

test("null threads still carry their diagnostic (so a resumed attempt knows they need retrying)", () => {
  const cache = extractBieThreadResults(bie());
  for (const thread of ["management", "competitive", "market", "industry", "transaction"] as const) {
    assert.equal(cache[thread]?.result, null);
    assert.equal(cache[thread]?.diagnostic.ok, false);
  }
});
