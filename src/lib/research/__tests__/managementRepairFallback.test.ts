import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { mockServerOnly } from "../../../../test/utils/mockServerOnly";
import type { BIEInput, BIEResult } from "@/lib/research/buddyIntelligenceEngine";

mockServerOnly();
const require_ = createRequire(import.meta.url);
const { repairManagementJson, buildManagementFallback, MANAGEMENT_FALLBACK_CONFIDENCE } =
  require_("@/lib/research/managementRepair") as typeof import("@/lib/research/managementRepair");
const { evaluateCompletionGate } =
  require_("@/lib/research/completionGate") as typeof import("@/lib/research/completionGate");

/**
 * SPEC-BIE-SAFE-PRIVATE-COMPANY-RESEARCH-HARDENING-1 — Phase 1
 * Management JSON repair + deterministic private-company fallback.
 */

// ── repairManagementJson ─────────────────────────────────────────────────────

test("[repair] valid management JSON is returned unchanged in shape", () => {
  const valid = JSON.stringify({
    principal_profiles: [
      {
        name: "Jane Doe",
        identity_confirmed: true,
        identity_confidence: 0.9,
        identity_notes: "Confirmed via state registry",
        background: "20 years in BPO",
        other_ventures: "None",
        track_record: "Strong",
        red_flags: "No adverse events identified in public records",
      },
    ],
    management_depth: "Deep bench",
    key_person_risk: "Moderate",
    ownership_and_governance: "Sole owner",
  });
  const r = repairManagementJson(valid);
  assert.ok(r);
  assert.equal(r!.principal_profiles.length, 1);
  assert.equal(r!.principal_profiles[0].name, "Jane Doe");
  assert.equal(r!.principal_profiles[0].identity_confirmed, true);
  assert.equal(r!.management_depth, "Deep bench");
});

test("[repair] recoverable malformation (trailing comma + smart quotes) repairs", () => {
  const malformed =
    '{“management_depth”: “Seasoned team”, “key_person_risk”: “High”, “ownership_and_governance”: “Founder-led”, “principal_profiles”: [],}';
  const r = repairManagementJson(malformed);
  assert.ok(r, "trailing comma + smart quotes should be repaired");
  assert.equal(r!.management_depth, "Seasoned team");
});

test("[repair] unrecoverable prose-in-value (OmniCare case) returns null → fallback territory", () => {
  // The exact live failure: a value position opening with a bare `.` and prose.
  const malformed =
    '{"principal_profiles":. He possesses over 25 years of experience in the BPO industry';
  const r = repairManagementJson(malformed);
  assert.equal(r, null);
});

test("[repair] does not invent principals — nameless profile entries are dropped", () => {
  const malformed = JSON.stringify({
    principal_profiles: [{ identity_confirmed: true }, { name: "X" }],
    management_depth: "x",
    key_person_risk: "",
    ownership_and_governance: "",
  });
  const r = repairManagementJson(malformed);
  assert.ok(r);
  // First entry (no name) dropped; second (name length < 2) also dropped.
  assert.equal(r!.principal_profiles.length, 0);
});

// ── buildManagementFallback ──────────────────────────────────────────────────

function input(over: Partial<BIEInput> = {}): BIEInput {
  return {
    company_name: "OmniCare 365",
    naics_code: "561422",
    naics_description: "Telephone call centers",
    city: "Anytown",
    state: "TX",
    geography: "TX",
    principals: [{ name: "Matt Hunt", title: "President" }],
    has_banker_certified_anchor: true,
    ...over,
  } as BIEInput;
}

test("[fallback] private borrower with principals → file-based profile per principal", () => {
  const r = buildManagementFallback(input());
  assert.ok(r);
  assert.equal(r!.principal_profiles.length, 1);
  assert.equal(r!.principal_profiles[0].name, "Matt Hunt");
  assert.equal(r!.principal_profiles[0].title, "President");
});

test("[fallback] never sets identity_confirmed=true", () => {
  const r = buildManagementFallback(input({ principals: [{ name: "A B" }, { name: "C D" }] }));
  assert.ok(r);
  for (const p of r!.principal_profiles) {
    assert.equal(p.identity_confirmed, false);
    assert.equal(p.identity_confidence, MANAGEMENT_FALLBACK_CONFIDENCE);
  }
});

test("[fallback] no principals → no fabricated fallback (null)", () => {
  assert.equal(buildManagementFallback(input({ principals: [] })), null);
});

test("[fallback] principals but no banker-certified anchor → null", () => {
  assert.equal(buildManagementFallback(input({ has_banker_certified_anchor: false })), null);
});

test("[fallback] single principal → key-person dependency stated", () => {
  const r = buildManagementFallback(input());
  assert.match(r!.key_person_risk, /key-person/i);
});

// ── gate: fallback management cannot unlock committee_grade ───────────────────

function bieWithFallbackMgmt(): BIEResult {
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
      principal_profiles: [
        {
          name: "Matt Hunt",
          title: "President",
          identity_confirmed: false,
          identity_confidence: 0.45,
          identity_notes: "Banker-certified management profile on file",
          background: "Banker-certified/file-based profile only; public confirmation limited.",
          other_ventures: "Unknown from public sources.",
          track_record: "Banker-certified experience on file; public confirmation limited.",
          red_flags: "No public adverse events confirmed from available research; public confirmation limited.",
        },
      ],
      management_depth: "File-based",
      key_person_risk: "key-person dependency",
      ownership_and_governance: "confirm before committee",
    },
    management_basis: "fallback",
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
    compiled_at: "2026-06-03T00:00:00Z",
  };
}

test("[gate] fallback management → warn, file-based copy, NOT committee_grade", () => {
  const r = evaluateCompletionGate(bieWithFallbackMgmt(), "m1", {
    naicsCode: "561422",
    entityClassification: "probable_private_entity",
    bankerCertifiedEvidence: { hasStory: true, hasManagement: true, hasFinancials: true },
    managementBasis: "fallback",
  });
  const mgmt = r.checks.find((c) => c.gate_id === "management_validation")!;
  assert.equal(mgmt.severity, "warn");
  assert.match(mgmt.reason, /banker-certified\/file-based/i);
  assert.notEqual(r.trust_grade, "committee_grade");
  assert.notEqual(r.trust_grade, "research_failed");
});

test("[gate] no profiles → message is not 'management not possible'", () => {
  const bie = bieWithFallbackMgmt();
  (bie.management as any) = { principal_profiles: [], management_depth: "", key_person_risk: "", ownership_and_governance: "" };
  const r = evaluateCompletionGate(bie, "m1", {
    naicsCode: "561422",
    entityClassification: "probable_private_entity",
    managementBasis: null,
  });
  const mgmt = r.checks.find((c) => c.gate_id === "management_validation")!;
  assert.doesNotMatch(mgmt.reason, /not possible/i);
});
