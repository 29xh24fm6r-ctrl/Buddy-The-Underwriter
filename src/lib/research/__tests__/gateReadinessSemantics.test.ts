import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
import type { BIEResult } from "@/lib/research/buddyIntelligenceEngine";

mockServerOnly();
const require_ = createRequire(import.meta.url);
const { evaluateCompletionGate } =
  require_("@/lib/research/completionGate") as typeof import("@/lib/research/completionGate");

/**
 * SPEC-BIE-SAFE-PRIVATE-COMPANY-RESEARCH-HARDENING-1 — Phase 6
 * Trust grade / readiness semantics.
 */

function bie(over: Partial<BIEResult> = {}): BIEResult {
  const thread = {} as any;
  return {
    entity_lock: {
      confirmed_name: "OmniCare 365",
      confirmed_location: "Anytown, TX",
      confirmed_industry: "Call centers",
      entity_confidence: 0.55,
      disambiguation_notes: "private_company_limited_public_footprint",
      alternative_entities_found: [],
      research_scope: "",
      entity_classification: "probable_private_entity",
    },
    entity_confirmed: false,
    entity_confidence: 0.55,
    entity_classification: "probable_private_entity",
    borrower: thread,
    management: {
      principal_profiles: [{
        name: "Matt Hunt", title: "President", identity_confirmed: false, identity_confidence: 0.45,
        identity_notes: "file", background: "", other_ventures: "", track_record: "", red_flags: "",
      }],
      management_depth: "x", key_person_risk: "x", ownership_and_governance: "x",
    },
    management_basis: "fallback",
    competitive: { direct_competitors: [{ name: "A" }, { name: "B" }] } as any,
    market: thread,
    industry: thread,
    transaction: thread,
    synthesis: {
      executive_credit_thesis: "thesis", management_profiles_validated: false,
      entity_validation_passed: false, contradictions_and_uncertainties: [],
      underwriting_questions: [], validation_notes: "",
    } as any,
    research_quality: "deep",
    sources_used: ["https://omnicare365.com/about", "https://example.com/a"],
    thread_sources: { borrower: [], management: [], competitive: [], market: [], industry: [], transaction: [], entity_lock: [] },
    thread_diagnostics: {} as any,
    compiled_at: "2026-06-03T00:00:00Z",
    ...over,
  };
}

// A banker-certified private borrower with a strong file but thin public web.
const strongFileOpts = {
  naicsCode: "561422",
  entityClassification: "probable_private_entity" as const,
  managementBasis: "fallback" as const,
  borrowerDomain: "omnicare365.com",
  bankerCertifiedEvidence: { hasStory: true, hasManagement: true, hasFinancials: true },
  evidenceSignals: {
    hasLegalName: true, hasWebsite: true, hasHqLocation: true, hasBankerIdentitySummary: true,
    hasNaics: true, hasIndustryDescription: true, hasBusinessDescription: true,
    hasProductsServices: true, hasCustomerAnchors: true, hasCompetitivePosition: true,
    hasRevenue: true, hasDscr: true, hasFinancialStatements: true, hasLoanRequest: true,
    privateCompanyMode: true,
  },
};

test("[readiness] strong private file → preliminary, gate_passed clears memo readiness", () => {
  const r = evaluateCompletionGate(bie(), "m1", strongFileOpts);
  assert.equal(r.trust_grade, "preliminary");
  assert.equal(r.gate_passed, true);
  assert.equal(r.preliminary_eligible, true);
  assert.equal(r.preliminary_basis, "banker_certified_private_company");
});

test("[readiness] committee remains blocked with explicit committee blockers", () => {
  const r = evaluateCompletionGate(bie(), "m1", strongFileOpts);
  assert.equal(r.committee_eligible, false);
  assert.notEqual(r.trust_grade, "committee_grade");
  assert.ok(r.committee_blockers.length > 0);
  assert.ok(r.committee_blockers.some((b) => /public\/attested/i.test(b)));
});

test("[readiness] public weakness alone does not force research_failed", () => {
  const r = evaluateCompletionGate(bie(), "m1", strongFileOpts);
  assert.notEqual(r.trust_grade, "research_failed");
});

test("[readiness] wrong-entity stays research_failed", () => {
  const r = evaluateCompletionGate(
    bie({ entity_classification: "wrong_entity_risk", entity_confidence: 0.6 }),
    "m1",
    { ...strongFileOpts, entityClassification: "wrong_entity_risk" },
  );
  assert.equal(r.trust_grade, "research_failed");
  assert.equal(r.preliminary_basis, null);
});

test("[readiness] evidence_quality + checklist + section statuses persisted on result", () => {
  const r = evaluateCompletionGate(bie(), "m1", strongFileOpts);
  assert.ok(r.evidence_quality);
  assert.equal(r.contradiction_checklist.length, 8);
  assert.equal(r.section_source_statuses.length, 6);
});
