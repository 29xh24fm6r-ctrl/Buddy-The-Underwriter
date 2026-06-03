import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
import type { BIEResult } from "@/lib/research/buddyIntelligenceEngine";

// claimLedger imports supabaseAdmin (server-only) at module scope; redirect the
// guard before requiring it. The functions under test are pure.
mockServerOnly();
const require_ = createRequire(import.meta.url);
const {
  mapClaimLayerToEvidenceType,
  RESEARCH_EVIDENCE_TYPES,
  buildClaimRecords,
  toEvidenceRow,
} = require_("@/lib/research/claimLedger") as typeof import("@/lib/research/claimLedger");

/**
 * SPEC-CLAIM-LEDGER-EVIDENCE-TYPE-MAPPING-1
 *
 * Root cause: the insert wrote evidence_type = claim_layer, so "narrative"
 * violated buddy_research_evidence_evidence_type_check → 0 rows all-time.
 */

// The enum allowed by the live DB CHECK constraint
// (buddy_research_evidence_evidence_type_check). Pinned here so any drift
// between the code's RESEARCH_EVIDENCE_TYPES and the DB is caught.
const DB_ALLOWED_EVIDENCE_TYPES = [
  "fact",
  "inference",
  "narrative_citation",
  "external_document",
  "financial_metric",
  "benchmark_comparison",
] as const;

// ── Schema contract ──────────────────────────────────────────────────────────

test("[contract] RESEARCH_EVIDENCE_TYPES matches the DB-allowed enum", () => {
  assert.deepEqual([...RESEARCH_EVIDENCE_TYPES].sort(), [...DB_ALLOWED_EVIDENCE_TYPES].sort());
});

test("[contract] mapper only returns DB-allowed evidence_type values", () => {
  const allowed = new Set<string>(DB_ALLOWED_EVIDENCE_TYPES);
  for (const layer of ["fact", "inference", "narrative"] as const) {
    assert.ok(allowed.has(mapClaimLayerToEvidenceType(layer)), `layer ${layer} maps outside the enum`);
  }
});

test("[contract] narrative → narrative_citation (the violating case)", () => {
  assert.equal(mapClaimLayerToEvidenceType("narrative"), "narrative_citation");
  assert.equal(mapClaimLayerToEvidenceType("fact"), "fact");
  assert.equal(mapClaimLayerToEvidenceType("inference"), "inference");
});

// ── Persistence regression (pure, no DB) ─────────────────────────────────────

function fakeBIE(): BIEResult {
  const long = (s: string) => s.padEnd(25, " .");
  return {
    entity_lock: {
      confirmed_name: long("OmniCare 365 BPO Inc"),
      confirmed_location: "Anytown, TX",
      confirmed_industry: "Call centers",
      entity_confidence: 1.0,
      disambiguation_notes: long("Excluded CVS Omnicare; private firm"),
      alternative_entities_found: [],
      research_scope: long("Research covers OmniCare 365 in TX"),
      entity_classification: "probable_private_entity",
    },
    entity_confirmed: true,
    entity_confidence: 1.0,
    entity_classification: "probable_private_entity",
    borrower: {
      entity_confirmation: long("Covers OmniCare 365"),
      entity_confidence: 0.9,
      company_overview: long("Founded 2010, BPO services"),
      reputation_and_reviews: long("Positive reviews on the web"),
      recent_news: long("Expanded into a new market"),
      litigation_and_risk: long("No significant adverse events found"),
      digital_presence: long("Active website and socials"),
      customer_base_and_reach: long("Serves regional healthcare clients"),
      trend_direction: "stable",
    },
    management: null,
    management_basis: null,
    competitive: null,
    market: null,
    industry: null,
    transaction: {
      primary_repayment_source: long("Operating cash flow from BPO contracts"),
      secondary_repayment_source: long("Owner guarantee"),
      repayment_vulnerabilities: long("Customer concentration risk"),
      structure_alignment: long("Term aligns with asset life"),
      transaction_type: "self-liquidating",
      collateral_adequacy: long("AR provides moderate coverage"),
      downside_case: long("A 10% revenue decline still covers debt service"),
      stress_scenario: long("Rate +200bps tightens but holds"),
    },
    synthesis: {
      executive_credit_thesis: long("Strong file-based thesis for OmniCare 365"),
      repayment_strengths: [],
      core_vulnerabilities: [],
      opportunities: [],
      threats: [],
      structure_implications: [],
      underwriting_questions: [],
      approval_conditions: [],
      monitoring_triggers: [],
      three_year_outlook: long("Stable growth"),
      five_year_outlook: long("Continued stability"),
      contradictions_and_uncertainties: [],
      evidence_quality_summary: long("Moderate"),
      research_quality_score: "Moderate",
      entity_validation_passed: true,
      management_profiles_validated: true,
      validation_notes: "",
    },
    research_quality: "deep",
    sources_used: ["https://omnicare365.com/about", "https://www.bizjournals.com/dallas/x"],
    thread_sources: {
      entity_lock: ["https://omnicare365.com/about"],
      borrower: ["https://www.bizjournals.com/dallas/x"],
      management: [],
      competitive: [],
      market: [],
      industry: [],
      transaction: [],
    },
    thread_diagnostics: {} as any,
    compiled_at: "2026-06-03T00:00:00Z",
  };
}

test("[persistence] rows map each layer to the correct evidence_type, none violating", () => {
  const claims = buildClaimRecords("m-test", fakeBIE());
  const rows = claims.map(toEvidenceRow);
  assert.ok(rows.length > 0);

  const allowed = new Set<string>(DB_ALLOWED_EVIDENCE_TYPES);
  for (const r of rows) {
    assert.ok(allowed.has(r.evidence_type), `evidence_type ${r.evidence_type} violates the CHECK`);
  }

  const types = new Set(rows.map((r) => r.evidence_type));
  assert.ok(types.has("fact"), "entity_lock/litigation facts → fact");
  assert.ok(types.has("inference"), "transaction → inference");
  assert.ok(types.has("narrative_citation"), "borrower/synthesis narrative → narrative_citation");
});

test("[persistence] first-class columns populated; narrative claim_layer preserved", () => {
  const rows = buildClaimRecords("m-test", fakeBIE()).map(toEvidenceRow);

  // The narrative→narrative_citation row keeps claim_layer = "narrative".
  const narrativeRow = rows.find((r) => r.evidence_type === "narrative_citation");
  assert.ok(narrativeRow);
  assert.equal(narrativeRow!.claim_layer, "narrative");
  assert.ok(narrativeRow!.section && narrativeRow!.section.length > 0);
  assert.ok(narrativeRow!.thread_origin && narrativeRow!.thread_origin.length > 0);

  // Every row carries mission_id, section, thread_origin.
  for (const r of rows) {
    assert.equal(r.mission_id, "m-test");
    assert.ok(typeof r.section === "string" && r.section.length > 0);
    assert.ok(typeof r.thread_origin === "string" && r.thread_origin.length > 0);
  }

  // source_uris/source_types populated where the thread had sources (entity_lock/borrower).
  const borrowerRow = rows.find((r) => r.thread_origin === "borrower" && r.source_uris.length > 0);
  assert.ok(borrowerRow, "borrower claim should carry source_uris");
  assert.equal(borrowerRow!.source_uris.length, borrowerRow!.source_types.length);
});
