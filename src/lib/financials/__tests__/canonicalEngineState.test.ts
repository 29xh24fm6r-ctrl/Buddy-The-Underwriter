/**
 * SPEC-FINANCIAL-ANALYSIS-CANONICAL-ENGINE-AND-ADS-MATERIALIZATION-1
 *
 * The Financial Analysis snapshot must consume the SAME canonical/certified
 * engine values the GCF page and spreads use — never independently reselect a
 * weaker raw fact when a canonical/certified value exists.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCanonicalEngineState,
  type EngineFactRow,
} from "@/lib/financials/canonicalEngineState";
import {
  overlayCanonicalEngineState,
  buildSnapshotFromFacts,
  type MinimalFact,
} from "@/lib/deals/financialSnapshotCore";

// Literals (keys.ts is server-only — cannot import CANONICAL_FACTS in a pure test).
const ADS = { fact_type: "FINANCIAL_ANALYSIS", fact_key: "ANNUAL_DEBT_SERVICE" };

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

// Omnicare-shaped active facts after retry compute.
function omnicareFacts(): EngineFactRow[] {
  return [
    row({ fact_key: "CASH_FLOW_AVAILABLE", fact_value_num: 205_112.47, source_canonical_type: "STRUCTURAL" }),
    row({ fact_key: "ANNUAL_DEBT_SERVICE", fact_value_num: 101_250 }),
    row({ fact_key: "GCF_GLOBAL_CASH_FLOW", fact_value_num: 88_862, owner_type: "GLOBAL" }),
    row({ fact_key: "GCF_DSCR", fact_value_num: 0.878 }),
    row({
      fact_key: "PFS_ANNUAL_DEBT_SERVICE",
      fact_value_num: 216_000,
      owner_type: "PERSONAL",
      owner_entity_id: OWNER,
    }),
    row({
      fact_key: "PFS_LIVING_EXPENSES",
      fact_value_num: 216_000,
      owner_type: "PERSONAL",
      owner_entity_id: OWNER,
    }),
    // personal income components (for GCF prereq + certified personal income)
    row({ fact_key: "WAGES_W2", fact_value_num: 310_134, owner_type: "PERSONAL", owner_entity_id: OWNER, fact_period_end: "2025-12-31", fact_type: "PERSONAL_TAX_RETURN" }),
  ];
}

test("[engine-1] Omnicare engine state exposes canonical ADS / PFS / GCF values", () => {
  const s = buildCanonicalEngineState(omnicareFacts());
  assert.equal(s.annualDebtService.value, 101_250);
  assert.equal(s.cashFlowAvailable.value, 205_112.47);
  assert.equal(s.gcfGlobalCashFlow.value, 88_862);
  assert.equal(s.gcfDscr.value, 0.878);
  assert.equal(s.pfsAnnualDebtService.value, 216_000);
  assert.equal(s.pfsLivingExpenses.value, 216_000);
  assert.equal(s.prerequisitesReady, true);
});

test("[engine-2] missing ADS surfaces the canonical earliest-missing-prerequisite diagnostic", () => {
  const facts = omnicareFacts().filter((f) => f.fact_key !== "ANNUAL_DEBT_SERVICE");
  const s = buildCanonicalEngineState(facts);
  assert.equal(s.annualDebtService.value, null);
  assert.equal(s.prerequisitesReady, false);
  assert.equal(s.earliestMissingPrerequisite?.key, "annual_debt_service");
  assert.ok(s.diagnostics.some((d) => /ANNUAL_DEBT_SERVICE/.test(d)));
});

test("[engine-3] canonical GCF prefers GCF_GLOBAL_CASH_FLOW over legacy GLOBAL_CASH_FLOW", () => {
  const facts: EngineFactRow[] = [
    row({ fact_key: "GLOBAL_CASH_FLOW", fact_value_num: 50_000 }),
    row({ fact_key: "GCF_GLOBAL_CASH_FLOW", fact_value_num: 88_862 }),
  ];
  const s = buildCanonicalEngineState(facts);
  assert.equal(s.gcfGlobalCashFlow.value, 88_862);
  assert.equal(s.gcfGlobalCashFlow.source, "canonical_fact");
});

test("[engine-4] superseded ADS fact is ignored by the engine", () => {
  const facts: EngineFactRow[] = [
    row({ fact_key: "ANNUAL_DEBT_SERVICE", fact_value_num: 75_000, fact_period_end: "2025-01-01", is_superseded: true }),
    row({ fact_key: "ANNUAL_DEBT_SERVICE", fact_value_num: 101_250 }),
  ];
  const s = buildCanonicalEngineState(facts);
  assert.equal(s.annualDebtService.value, 101_250);
});

test("[engine-5] overlay overrides snapshot metrics with canonical values and attaches engine state", () => {
  // Base snapshot built from a DIVERGENT raw ADS fact (a weaker manual stub).
  const baseFacts: MinimalFact[] = [
    {
      id: "raw-ads",
      fact_type: ADS.fact_type,
      fact_key: ADS.fact_key,
      fact_period_start: "2026-06-26",
      fact_period_end: "2026-06-26",
      fact_value_num: 75_000,
      fact_value_text: null,
      confidence: 0.9,
      provenance: { source_type: "STRUCTURAL", source_ref: "x" },
      created_at: "2026-06-26T00:00:00Z",
    } as MinimalFact,
  ];
  const base = buildSnapshotFromFacts({ facts: baseFacts, metricSpecs: [
    {
      metric: "annual_debt_service",
      fact_type: ADS.fact_type,
      fact_key: ADS.fact_key,
    },
  ] });
  assert.equal(base.annual_debt_service.value_num, 75_000);

  // Canonical engine says 101,250 — overlay must win.
  const state = buildCanonicalEngineState([row({ fact_key: "ANNUAL_DEBT_SERVICE", fact_value_num: 101_250 })]);
  const overlaid = overlayCanonicalEngineState(base, state);
  assert.equal(overlaid.annual_debt_service.value_num, 101_250);
  assert.equal(overlaid.annual_debt_service.provenance?.canonical_overlay, true);
  assert.ok(overlaid.canonical_engine);
  assert.equal(overlaid.canonical_engine?.annualDebtService.value, 101_250);
});

test("[engine-6] overlay never nulls out an existing value when canonical is absent", () => {
  const baseFacts: MinimalFact[] = [
    {
      id: "raw-ads",
      fact_type: ADS.fact_type,
      fact_key: ADS.fact_key,
      fact_period_start: "2026-06-26",
      fact_period_end: "2026-06-26",
      fact_value_num: 90_000,
      fact_value_text: null,
      confidence: 0.9,
      provenance: { source_type: "STRUCTURAL", source_ref: "x" },
      created_at: "2026-06-26T00:00:00Z",
    } as MinimalFact,
  ];
  const base = buildSnapshotFromFacts({ facts: baseFacts, metricSpecs: [
    {
      metric: "annual_debt_service",
      fact_type: ADS.fact_type,
      fact_key: ADS.fact_key,
    },
  ] });
  // Engine has NO ADS fact → canonical value null → must not clobber base 90,000.
  const state = buildCanonicalEngineState([]);
  const overlaid = overlayCanonicalEngineState(base, state);
  assert.equal(overlaid.annual_debt_service.value_num, 90_000);
});
