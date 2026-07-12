import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
import type { BIEResult } from "@/lib/research/buddyIntelligenceEngine";

// buddyIntelligenceEngine transitively imports `server-only`; redirect to the
// repo stub before requiring the runtime exports.
mockServerOnly();
const require_ = createRequire(import.meta.url);
const { classifyEntity, PRIVATE_ENTITY_CONFIDENCE_FLOOR } =
  require_("@/lib/research/buddyIntelligenceEngine") as typeof import("@/lib/research/buddyIntelligenceEngine");
const { evaluateCompletionGate } =
  require_("@/lib/research/completionGate") as typeof import("@/lib/research/completionGate");

/**
 * SPEC-RESEARCH-GATE-PRIVATE-BORROWER-AND-EVIDENCE-PACK-1
 *
 * Deterministic entity classification + the downgrade MVP in the completion
 * gate. A banker-certified private borrower with limited public footprint must
 * NOT be auto-failed; a wrong/conflicting public entity must still fail;
 * committee-grade stays strict.
 */

// ── classifyEntity (pure) ────────────────────────────────────────────────────

test("[classify] no search name → unconfirmed_needs_banker_identity", () => {
  const r = classifyEntity({
    companySearchName: null,
    hasBankerCertifiedAnchor: true,
    modelConfidence: 0,
    confirmedName: "UNCONFIRMED",
    alternativeEntitiesFound: [],
  });
  assert.equal(r.classification, "unconfirmed_needs_banker_identity");
  assert.equal(r.confidence, 0);
});

test("[classify] conf 0 + banker anchor + no conflict → probable_private_entity floored 0.55", () => {
  const r = classifyEntity({
    companySearchName: "OmniCare BPO, Inc.",
    hasBankerCertifiedAnchor: true,
    modelConfidence: 0,
    confirmedName: "UNCONFIRMED",
    alternativeEntitiesFound: [],
  });
  assert.equal(r.classification, "probable_private_entity");
  assert.equal(r.confidence, PRIVATE_ENTITY_CONFIDENCE_FLOOR);
});

test("[classify] model conf ≥ 0.7 → confirmed_public_entity (kept)", () => {
  const r = classifyEntity({
    companySearchName: "OmniCare BPO, Inc.",
    hasBankerCertifiedAnchor: true,
    modelConfidence: 0.9,
    confirmedName: "OmniCare BPO, Inc.",
    alternativeEntitiesFound: [],
  });
  assert.equal(r.classification, "confirmed_public_entity");
  assert.equal(r.confidence, 0.9);
});

test("[classify] mid confidence + name mismatch → wrong_entity_risk", () => {
  const r = classifyEntity({
    companySearchName: "OmniCare BPO, Inc.",
    hasBankerCertifiedAnchor: true,
    modelConfidence: 0.6,
    confirmedName: "CVS Health Corporation",
    alternativeEntitiesFound: ["CVS Health"],
  });
  assert.equal(r.classification, "wrong_entity_risk");
});

// Regression for specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md P0-4: the
// name-mismatch check previously only ran for modelConfidence in [0.5, 0.7),
// so a model that confidently (>=0.7) grounded onto a similarly-named but
// WRONG company bypassed the mismatch check entirely and was auto-classified
// as a confirmed match. High confidence must not exempt a mismatch.
test("[classify] HIGH confidence + name mismatch → still wrong_entity_risk, not confirmed", () => {
  const r = classifyEntity({
    companySearchName: "OmniCare BPO, Inc.",
    hasBankerCertifiedAnchor: true,
    modelConfidence: 0.85,
    confirmedName: "CVS Health Corporation",
    alternativeEntitiesFound: ["CVS Health"],
  });
  assert.equal(r.classification, "wrong_entity_risk");
  assert.notEqual(r.classification, "confirmed_public_entity");
});

test("[classify] no banker anchor + low conf → unconfirmed_needs_banker_identity", () => {
  const r = classifyEntity({
    companySearchName: "Some Co",
    hasBankerCertifiedAnchor: false,
    modelConfidence: 0.2,
    confirmedName: "UNCONFIRMED",
    alternativeEntitiesFound: [],
  });
  assert.equal(r.classification, "unconfirmed_needs_banker_identity");
});

// ── evaluateCompletionGate (downgrade MVP) ───────────────────────────────────

function bieResult(over: Partial<BIEResult> = {}): BIEResult {
  const thread = {} as any; // any non-null marks a thread "succeeded"
  return {
    entity_lock: {
      confirmed_name: "UNCONFIRMED",
      confirmed_location: "Unknown",
      confirmed_industry: "Unknown",
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
    management: { principal_profiles: [{ name: "Matt Hunt", title: "President", identity_confirmed: false, identity_confidence: 0.3, background: "", role_relevance: "", red_flags: [] }] } as any,
    management_basis: "public_web",
    competitive: thread,
    market: thread,
    industry: thread,
    transaction: thread,
    synthesis: {
      executive_credit_thesis: "thesis",
      management_profiles_validated: false,
      entity_validation_passed: false,
      contradictions_and_uncertainties: [],
      underwriting_questions: [],
      validation_notes: "",
    } as any,
    research_quality: "deep",
    sources_used: ["https://example.com/a"],
    thread_sources: { borrower: [], management: [], competitive: [], market: [], industry: [], transaction: [], entity_lock: [] },
    thread_diagnostics: {} as any,
    compiled_at: "2026-06-02T00:00:00Z",
    ...over,
  };
}

const bankerCertified = { hasStory: true, hasManagement: true, hasFinancials: true };

test("[gate] probable_private_entity + banker-certified → NOT research_failed", () => {
  const r = evaluateCompletionGate(bieResult(), "m1", {
    naicsCode: "999999",
    entityClassification: "probable_private_entity",
    bankerCertifiedEvidence: bankerCertified,
  });
  assert.notEqual(r.trust_grade, "research_failed");
  assert.ok(["manual_review_required", "preliminary"].includes(r.trust_grade));
  // entity gate is a warning, not an error
  const entity = r.checks.find((c) => c.gate_id === "entity_lock")!;
  assert.equal(entity.severity, "warn");
});

test("[gate] banker-certified principal unconfirmed → management warn, not error", () => {
  const r = evaluateCompletionGate(bieResult(), "m1", {
    naicsCode: "999999",
    entityClassification: "probable_private_entity",
    bankerCertifiedEvidence: bankerCertified,
  });
  const mgmt = r.checks.find((c) => c.gate_id === "management_validation")!;
  assert.equal(mgmt.severity, "warn");
});

test("[gate] conflicting/wrong public entity → research_failed preserved", () => {
  const r = evaluateCompletionGate(
    bieResult({ entity_classification: "wrong_entity_risk", entity_confidence: 0.6 }),
    "m1",
    { naicsCode: "999999", entityClassification: "wrong_entity_risk", bankerCertifiedEvidence: bankerCertified },
  );
  const entity = r.checks.find((c) => c.gate_id === "entity_lock")!;
  assert.equal(entity.severity, "error");
  assert.equal(r.trust_grade, "research_failed");
});

test("[gate] private entity floored at 0.55 cannot reach committee_grade", () => {
  const r = evaluateCompletionGate(bieResult(), "m1", {
    naicsCode: "561422", // real NAICS
    entityClassification: "probable_private_entity",
    bankerCertifiedEvidence: bankerCertified,
  });
  assert.notEqual(r.trust_grade, "committee_grade");
});

test("[gate] no banker-certified evidence + low public confidence → still fails hard", () => {
  const r = evaluateCompletionGate(
    bieResult({ entity_classification: "unconfirmed_needs_banker_identity", entity_confidence: 0 }),
    "m1",
    { naicsCode: "999999", entityClassification: "unconfirmed_needs_banker_identity", bankerCertifiedEvidence: { hasStory: false, hasManagement: false, hasFinancials: false } },
  );
  // No banker-certified management → management gate keeps its error on synthesis failure.
  assert.notEqual(r.trust_grade, "committee_grade");
  // Regression for specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md P0-5: a fully
  // unconfirmed entity (0% confidence) must not reach "preliminary" either —
  // that grade is sufficient to generate and circulate a full credit memo.
  assert.notEqual(r.trust_grade, "preliminary");
});
