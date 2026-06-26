/**
 * SPEC-COCKPIT-FINANCIAL-ANALYSIS-CANONICAL-ENGINE-VIEW-1
 *
 * The cockpit Financial Analysis card must render the SAME canonical/certified
 * engine state used by GCF, spreads, and financial snapshots — and must not show
 * stale gap-queue blockers for keys the engine has already resolved, while still
 * surfacing real (non-engine) review items.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildFinancialValidationViewModel,
  type ValidationGap,
} from "@/lib/financialReview/financialValidationView";
import {
  buildCanonicalEngineState,
  type EngineFactRow,
} from "@/lib/financials/canonicalEngineState";

const OWNER = "sponsor-1";

function row(over: Partial<EngineFactRow> & { fact_key: string }): EngineFactRow {
  return {
    id: `${over.fact_key}-${over.fact_period_end ?? "x"}`,
    fact_value_num: null,
    owner_type: "DEAL",
    owner_entity_id: null,
    fact_period_end: "2026-06-26",
    is_superseded: false,
    resolution_status: null,
    confidence: 0.9,
    provenance: { extractor: "test" },
    ...over,
  };
}

// Omnicare-shaped active facts after retry compute (engine prerequisites READY).
function omnicareEngineFacts(): EngineFactRow[] {
  return [
    row({ fact_key: "CASH_FLOW_AVAILABLE", fact_value_num: 205_112.47 }),
    row({ fact_key: "ANNUAL_DEBT_SERVICE", fact_value_num: 101_250 }),
    row({ fact_key: "GCF_GLOBAL_CASH_FLOW", fact_value_num: 88_862, owner_type: "GLOBAL" }),
    row({ fact_key: "GCF_DSCR", fact_value_num: 0.878 }),
    row({ fact_key: "PFS_ANNUAL_DEBT_SERVICE", fact_value_num: 216_000, owner_type: "PERSONAL", owner_entity_id: OWNER }),
    row({ fact_key: "PFS_LIVING_EXPENSES", fact_value_num: 216_000, owner_type: "PERSONAL", owner_entity_id: OWNER }),
    row({ fact_key: "WAGES_W2", fact_value_num: 310_134, owner_type: "PERSONAL", owner_entity_id: OWNER, fact_period_end: "2025-12-31", fact_type: "PERSONAL_TAX_RETURN" }),
  ];
}

function gap(over: Partial<ValidationGap> & { fact_key: string; gap_type: ValidationGap["gap_type"] }): ValidationGap {
  return {
    id: `gap-${over.fact_key}-${over.gap_type}`,
    description: "x",
    resolution_prompt: "x",
    priority: 90,
    fact_id: null,
    conflict_id: null,
    ...over,
  };
}

const READY_PACKAGE = { snapshotRowExists: true, decisionRowExists: true };

// ── Test 1: canonical ADS = 101,250 rendered for Omnicare-shaped data ─────────

test("[view-1] renders canonical ANNUAL_DEBT_SERVICE = 101,250 (same as GCF/spreads)", () => {
  const engine = buildCanonicalEngineState(omnicareEngineFacts());
  const vm = buildFinancialValidationViewModel({
    financialSnapshotExists: true,
    financialPackage: READY_PACKAGE,
    canonicalEngine: engine,
    gaps: [],
    completeness: 100,
  });

  const ads = vm.engineValues.find((v) => v.factKey === "ANNUAL_DEBT_SERVICE");
  assert.equal(ads?.value, 101_250);
  const pfsAds = vm.engineValues.find((v) => v.factKey === "PFS_ANNUAL_DEBT_SERVICE");
  assert.equal(pfsAds?.value, 216_000);
  const gcf = vm.engineValues.find((v) => v.factKey === "GCF_GLOBAL_CASH_FLOW");
  assert.equal(gcf?.value, 88_862);
  // All 7 canonical engine values are present for display.
  assert.equal(vm.engineValues.length, 7);
});

// ── Test 2: no stale ADS/PFS blockers when canonical engine says resolved ─────

test("[view-2] suppresses stale ADS/DSCR missing-fact gaps when prerequisites are ready", () => {
  const engine = buildCanonicalEngineState(omnicareEngineFacts());
  assert.equal(engine.prerequisitesReady, true);

  const vm = buildFinancialValidationViewModel({
    financialSnapshotExists: true,
    financialPackage: READY_PACKAGE,
    canonicalEngine: engine,
    gaps: [
      gap({ fact_key: "ANNUAL_DEBT_SERVICE", gap_type: "missing_fact" }),
      gap({ fact_key: "DSCR", gap_type: "missing_fact" }),
      gap({ fact_key: "PFS_LIVING_EXPENSES", gap_type: "missing_fact" }),
    ],
    completeness: 100,
  });

  assert.equal(vm.reviewItems.length, 0, "stale engine-prerequisite gaps must be dropped");
  assert.equal(vm.status, "ready_no_review");
});

// ── Test 3: real non-engine review items are NEVER hidden ─────────────────────

test("[view-3] keeps unresolved items that are not canonical-engine prerequisites", () => {
  const engine = buildCanonicalEngineState(omnicareEngineFacts());
  const vm = buildFinancialValidationViewModel({
    financialSnapshotExists: true,
    financialPackage: READY_PACKAGE,
    canonicalEngine: engine,
    gaps: [
      gap({ fact_key: "ANNUAL_DEBT_SERVICE", gap_type: "missing_fact" }), // engine-managed → dropped
      gap({ fact_key: "NET_INCOME", gap_type: "missing_fact" }), // NOT engine-managed → kept
      gap({ fact_key: "ANNUAL_DEBT_SERVICE", gap_type: "conflict" }), // conflict → never hidden
    ],
    completeness: 80,
  });

  const keys = vm.reviewItems.map((g) => `${g.fact_key}:${g.gap_type}`);
  assert.ok(keys.includes("NET_INCOME:missing_fact"), "non-engine missing fact must survive");
  assert.ok(keys.includes("ANNUAL_DEBT_SERVICE:conflict"), "conflicts are never hidden");
  assert.ok(!keys.includes("ANNUAL_DEBT_SERVICE:missing_fact"), "stale engine missing-fact dropped");
  assert.equal(vm.status, "needs_review");
});

// ── Test 4: missing snapshot still routes to generate-snapshot affordance ─────

test("[view-4] no snapshot → no_snapshot state (generate-snapshot affordance)", () => {
  const vm = buildFinancialValidationViewModel({
    financialSnapshotExists: false,
    financialPackage: { snapshotRowExists: false, decisionRowExists: false },
    canonicalEngine: null,
    gaps: [],
    completeness: 0,
  });
  assert.equal(vm.status, "no_snapshot");
});

// ── Test 5: prerequisites missing → GCF-ordered diagnostics ───────────────────

test("[view-5] missing ADS prerequisite surfaces GCF-ordered diagnostics, not 'no review'", () => {
  const facts = omnicareEngineFacts().filter((f) => f.fact_key !== "ANNUAL_DEBT_SERVICE");
  const engine = buildCanonicalEngineState(facts);
  const vm = buildFinancialValidationViewModel({
    financialSnapshotExists: true,
    financialPackage: READY_PACKAGE,
    canonicalEngine: engine,
    gaps: [],
    completeness: 60,
  });

  assert.equal(vm.status, "prerequisites_missing");
  assert.ok(vm.prerequisites);
  assert.equal(vm.prerequisites!.ready, false);
  assert.equal(vm.prerequisites!.earliestMissing?.key, "annual_debt_service");
  // Ordered list preserves the GCF dependency order.
  assert.deepEqual(
    vm.prerequisites!.ordered.map((p) => p.key),
    ["business_cash_flow", "annual_debt_service", "personal_pfs"],
  );
});

// ── Test 6: persisted snapshot row but no decision row → recoverable state ─────

test("[view-6] snapshot row without decision row → recoverable, not 'no review needed yet'", () => {
  const engine = buildCanonicalEngineState(omnicareEngineFacts());
  const vm = buildFinancialValidationViewModel({
    financialSnapshotExists: false,
    financialPackage: { snapshotRowExists: true, decisionRowExists: false },
    canonicalEngine: engine,
    gaps: [],
    completeness: 100,
  });
  assert.equal(vm.status, "recoverable_decision_missing");
});
