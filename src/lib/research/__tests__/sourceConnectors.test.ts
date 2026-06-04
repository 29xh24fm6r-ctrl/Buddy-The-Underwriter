import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

/**
 * SPEC-BIE-OFFICIAL-SOURCE-CONNECTOR-FRAMEWORK-1
 * Connector spine + manual URL connector + registry / adverse / gov / competitor
 * adapters. Pure modules + a fetch-mockable connector.
 */

mockServerOnly();
const require_ = createRequire(import.meta.url);
const C = require_("@/lib/research/sourceConnectors") as typeof import("@/lib/research/sourceConnectors");
const { runManualUrlConnector } =
  require_("@/lib/research/sourceConnectors/manualUrlConnector") as typeof import("@/lib/research/sourceConnectors/manualUrlConnector");

// ── connector invariants ──────────────────────────────────────────────────────

test("[spine] allow-lists reject unknown kinds/types", () => {
  assert.equal(C.isAllowedConnectorKind("manual_url"), true);
  assert.equal(C.isAllowedConnectorKind("borrower_website"), false); // not route-allowed
  assert.equal(C.isAllowedConnectorKind("nonsense"), false);
  assert.equal(C.isAllowedSourceType("secretary_of_state"), true);
  assert.equal(C.isAllowedSourceType("ai_synthesis"), false);
});

test("[spine] connector results never carry committee acceptance and always require review", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response("<html><title>OK SOS</title></html>", { status: 200, headers: { "content-type": "text/html" } })) as any;
  try {
    const r = await runManualUrlConnector({
      missionId: "m", dealId: "d", taskId: "t", connectorKind: "secretary_of_state",
      sourceUrl: "sos.ok.gov/corp", sourceType: "secretary_of_state",
    });
    assert.equal(r.requires_review, true);
    assert.equal((r as any).committee_grade_accepted, undefined);
    for (const s of r.snapshots) assert.equal((s as any).committee_grade_accepted, undefined);
  } finally {
    globalThis.fetch = orig;
  }
});

// ── manual URL connector ──────────────────────────────────────────────────────

test("[manual_url] normalizes URL and stores a collected snapshot linked to the task", async () => {
  const orig = globalThis.fetch;
  let calledUrl = "";
  globalThis.fetch = (async (u: any) => {
    calledUrl = String(u);
    return new Response("<html><title>Result</title></html>", { status: 200, headers: { "content-type": "text/html" } });
  }) as any;
  try {
    const r = await runManualUrlConnector({
      missionId: "m1", dealId: "d1", taskId: "task1", connectorKind: "manual_url",
      sourceUrl: "sos.ok.gov/corp/find", sourceType: "secretary_of_state", note: "OK SOS",
    });
    assert.match(calledUrl, /^https:\/\//); // normalized to https
    assert.equal(r.ok, true);
    assert.equal(r.snapshots.length, 1);
    const s = r.snapshots[0];
    assert.equal(s.status, "collected");
    assert.equal(s.mission_id, "m1");
    assert.equal(s.source_type, "secretary_of_state");
    assert.ok(s.content_hash && s.content_hash.length === 64); // sha256
  } finally {
    globalThis.fetch = orig;
  }
});

test("[manual_url] fetch failure is non-fatal → failed snapshot + limitation, never throws", async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error("ECONNREFUSED"); }) as any;
  try {
    const r = await runManualUrlConnector({
      missionId: "m", dealId: "d", taskId: "t", connectorKind: "manual_url",
      sourceUrl: "https://example.com/x", sourceType: "unknown_public_web",
    });
    assert.equal(r.ok, false);
    assert.equal(r.snapshots[0].status, "failed");
    assert.ok(r.limitations.some((l) => /did not succeed/i.test(l)));
    assert.equal(r.requires_review, true);
  } finally {
    globalThis.fetch = orig;
  }
});

test("[manual_url] invalid URL → error, no snapshot", async () => {
  const r = await runManualUrlConnector({
    missionId: "m", dealId: "d", taskId: "t", connectorKind: "manual_url",
    sourceUrl: "   ", sourceType: "unknown_public_web",
  });
  assert.equal(r.error, "invalid_url");
  assert.equal(r.snapshots.length, 0);
});

// ── registry / SOS adapter ────────────────────────────────────────────────────

test("[registry] Oklahoma HQ → OK SOS candidate + guidance", () => {
  const cands = C.planRegistrySources({ hqState: "OK", legalName: "OmniCare 365" });
  assert.ok(cands.some((c) => c.source_type === "secretary_of_state" && /Oklahoma/i.test(c.label)));
  assert.ok(cands.some((c) => c.source_type === "business_registry")); // aggregator fallback
  assert.match(C.registryTaskGuidance("OK"), /Oklahoma/);
});

test("[registry] evidence shape validates + advisory match score, bad tier rejected", () => {
  const good = C.validateRegistryEvidence({
    legal_name: "OmniCare 365 LLC", entity_status: "Active", jurisdiction: "OK",
    source_tier: "tier_2_html_portal", collected_at: "2026-06-04T00:00:00.000Z", entity_match_score: 0.8, limitations: [],
  });
  assert.equal(good.ok, true);
  assert.equal(good.evidence?.entity_match_score, 0.8);
  assert.equal(C.validateRegistryEvidence({ source_tier: "bogus", collected_at: "x" }).ok, false);
  assert.equal(C.validateRegistryEvidence({ source_tier: "tier_1_open_api_or_bulk", collected_at: "x", entity_match_score: 5 }).ok, false);
});

// ── adverse screen adapter ────────────────────────────────────────────────────

test("[adverse] plan has targets + categories, all result types require review, no sanctions by default", () => {
  const plan = C.buildAdverseScreenPlan({ legalName: "OmniCare 365", principals: [{ person_name: "Matt Hunt" }] });
  assert.ok(plan.targets.some((t) => t.kind === "borrower_legal_name"));
  assert.ok(plan.targets.some((t) => t.kind === "principal"));
  assert.equal(plan.checklist.some((c) => c.category === "sanctions_watchlist"), false);
  assert.ok(plan.limitations.some((l) => /never auto-cleared/i.test(l)));
});

test("[adverse] cannot record an adverse claim without a source; attestation needs an attestor", () => {
  assert.equal(C.validateAdverseDisposition({ result_type: "confirmed_adverse_record" }).ok, false);
  assert.equal(C.validateAdverseDisposition({ result_type: "potential_hit_needs_review" }).ok, false);
  assert.equal(
    C.validateAdverseDisposition({ result_type: "confirmed_adverse_record", source_url: "https://courtlistener.com/x" }).ok,
    true,
  );
  assert.equal(C.validateAdverseDisposition({ result_type: "no_public_adverse_records_found_attestation" }).ok, false);
  assert.equal(
    C.validateAdverseDisposition({ result_type: "no_public_adverse_records_found_attestation", attested_by: "analyst_1" }).ok,
    true,
  );
});

// ── BLS/Census/FRED candidate planner ─────────────────────────────────────────

test("[gov] emits BLS + Census + FRED candidates for NAICS 561422 + geography", () => {
  const cands = C.planGovernmentSources({ naicsCode: "561422", naicsDescription: "Telemarketing/contact center", hqCity: "Durant", hqState: "OK", loanType: "LOC_SECURED" });
  const labels = cands.map((c) => c.label).join(" | ");
  assert.match(labels, /BLS/);
  assert.match(labels, /Census/);
  assert.match(labels, /FRED/);
  assert.ok(cands.every((c) => c.source_type === "government_data"));
  assert.ok(cands.some((c) => c.recommended_for_sections.includes("Industry Overview")));
  assert.ok(cands.some((c) => c.recommended_for_sections.includes("Market Intelligence")));
  // NAICS appears in BLS/Census candidate URLs/labels
  assert.ok(cands.some((c) => /561422/.test(`${c.label} ${c.source_url ?? ""}`)));
});

test("[gov] invalid/placeholder NAICS → still emits candidates, flags limitation", () => {
  const cands = C.planGovernmentSources({ naicsCode: "999999" });
  assert.ok(cands.length >= 3);
  assert.ok(cands.some((c) => c.limitations.some((l) => /NAICS/i.test(l))));
});

// ── competitor source adapter ─────────────────────────────────────────────────

test("[competitor] generates a candidate per named competitor from competitive claims", () => {
  const cands = C.planCompetitorSources([
    { id: "1", thread_origin: "competitive", claim: "TeleDirect: a 24/7 call center provider" },
    { id: "2", thread_origin: "competitive", claim: "ASK Telemarketing: an Oklahoma firm" },
  ]);
  const labels = cands.map((c) => c.label).join(" | ");
  assert.match(labels, /TeleDirect/);
  assert.match(labels, /ASK Telemarketing/);
  assert.ok(cands.every((c) => c.requirement_keys.includes("competitive_support")));
  assert.ok(cands.every((c) => c.limitations.some((l) => /caveat|needs_review|verify/i.test(l))));
});

test("[competitor] no competitive rows → no candidates", () => {
  assert.equal(C.planCompetitorSources([]).length, 0);
});

// ── aggregator ────────────────────────────────────────────────────────────────

test("[aggregate] buildSourceCandidatePlan assembles all candidate groups (OmniCare-like)", () => {
  const plan = C.buildSourceCandidatePlan({
    naicsCode: "561422", hqState: "OK", hqCity: "Durant", loanType: "LOC_SECURED",
    legalName: "OmniCare 365", principals: [{ person_name: "Matt Hunt" }],
    competitiveRows: [{ id: "1", thread_origin: "competitive", claim: "TeleDirect: provider" }],
  });
  assert.ok(plan.registry_candidates.length >= 1);
  assert.ok(plan.government_candidates.length >= 3);
  assert.ok(plan.competitor_candidates.length >= 1);
  assert.ok(plan.adverse_screen_plan.checklist.length >= 1);
  assert.match(plan.registry_task_guidance, /Oklahoma/);
});
