/**
 * SPEC-FINENGINE-DECISION-CORE-SHADOW-1 — decision-core shadow harness tests.
 *
 * Gating correctness over { DSCR, DSCR_STRESSED_300BPS }, key/period alignment (R3),
 * the stress-input mapping (+12% fallback), and the net-new-never-gated firewall.
 * Pure: no DB; runs under `node --test --import tsx`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  runDecisionCoreShadow,
  DECISION_CORE_OVERLAPPING,
} from "@/lib/finengine/shadow/runDecisionCoreShadow";
import { runGlobalCashFlowShadow } from "@/lib/finengine/shadow/globalCashFlowAdapter";
import { buildStressInputs } from "@/lib/finengine/shadow/stressInputsAdapter";
import { rateShock } from "@/lib/finengine/stress/stressEngine";
import type { GoldenSetEntry } from "@/lib/finengine/shadow/reconcile";
import type { CertifiedFactRow } from "@/lib/finengine/shadow/dealInputAdapter";

const DEAL = "eefd62b3-4ae2-4d43-bb80-9953fdca9bcc";
const GEM = "gemini_primary_v1";
const DECISION_PERIOD = "2026-06-29"; // matches the live legacy DSCR rows

function r(fact_key: string, period: string, value: number, sct: string | null, owner: string): CertifiedFactRow {
  return { fact_key, fact_period_end: period, fact_value_num: value, source_canonical_type: sct, owner_type: owner, confidence: 0.8, extractor: GEM, is_superseded: false, created_at: "2026-06-01T00:00:00Z" };
}
const biz = (k: string, p: string, v: number) => r(k, p, v, "BUSINESS_TAX_RETURN", "DEAL");
const ptr = (k: string, p: string, v: number) => r(k, p, v, "PERSONAL_TAX_RETURN", "DEAL");
const pfs = (k: string, p: string, v: number) => r(k, p, v, "PFS", "PERSONAL");
const dealFact = (k: string, p: string, v: number) => r(k, p, v, null, "DEAL");
const legacyDscr = (k: string, v: number) => r(k, DECISION_PERIOD, v, null, "DEAL");

// OmniCare-shaped fixture (no legacy DSCR rows — added per test).
const BASE_ROWS: CertifiedFactRow[] = [
  biz("M1_TAXABLE_INCOME", "2024-12-31", 200925),
  biz("DEPRECIATION", "2024-12-31", 210207),
  biz("GROSS_RECEIPTS", "2024-12-31", 28767069),
  biz("GROSS_PROFIT", "2024-12-31", 3533599),
  dealFact("ANNUAL_DEBT_SERVICE", "2026-06-29", 101250),
  dealFact("ANNUAL_DEBT_SERVICE_PROPOSED", "2026-06-29", 101250),
  ptr("WAGES_W2", "2024-12-31", 310000),
  pfs("PFS_SALARY_WAGES", "2025-10-07", 250000),
  pfs("PFS_ANNUAL_DEBT_SERVICE", "2025-10-07", 19800),
  pfs("PFS_LIVING_EXPENSES", "2025-10-07", 19800),
];

// Finengine producers (read once for use as expected values).
const baseline = runDecisionCoreShadow(DEAL, BASE_ROWS);
const FIN_DSCR = baseline.globalDSCR!;
const FIN_STRESSED = baseline.stressedDSCR!;

describe("[dcs] decision-core shadow — finengine producers", () => {
  it("[dcs-0] finengine global DSCR + stressed DSCR are computed and finite", () => {
    assert.ok(Number.isFinite(FIN_DSCR));
    assert.ok(Number.isFinite(FIN_STRESSED));
    // Rate shock is more conservative than the base DSCR (denominator stressed up).
    assert.ok(FIN_STRESSED < FIN_DSCR);
  });
});

describe("[dcs] decision-core shadow — gating correctness", () => {
  it("[dcs-1] finengine == legacy on both DSCRs → ZERO, cutoverBlocked=false", () => {
    const rows = [...BASE_ROWS, legacyDscr("DSCR", FIN_DSCR), legacyDscr("DSCR_STRESSED_300BPS", FIN_STRESSED)];
    const { report } = runDecisionCoreShadow(DEAL, rows);
    assert.equal(report.total, 2);
    assert.equal(report.zero, 2);
    assert.equal(report.unexpected, 0);
    assert.equal(report.cutoverBlocked, false);
  });

  it("[dcs-2] divergent with matching golden → INTENDED, not blocked", () => {
    const rows = [...BASE_ROWS, legacyDscr("DSCR", 2.026), legacyDscr("DSCR_STRESSED_300BPS", 1.402)];
    const goldenSet: GoldenSetEntry[] = [
      { dealId: DEAL, factKey: "DSCR", ownerType: "DEAL", fiscalPeriodEnd: DECISION_PERIOD, expectedNewValue: FIN_DSCR, rationale: "corrected global denominator", spec: "SPEC-FINENGINE-DECISION-CORE-GOLDEN-1" },
      { dealId: DEAL, factKey: "DSCR_STRESSED_300BPS", ownerType: "DEAL", fiscalPeriodEnd: DECISION_PERIOD, expectedNewValue: FIN_STRESSED, rationale: "corrected global denominator under +300bps", spec: "SPEC-FINENGINE-DECISION-CORE-GOLDEN-1" },
    ];
    const { report } = runDecisionCoreShadow(DEAL, rows, goldenSet);
    assert.equal(report.intended, 2);
    assert.equal(report.unexpected, 0);
    assert.equal(report.cutoverBlocked, false);
  });

  it("[dcs-3] divergent without golden → UNEXPECTED, cutoverBlocked=true (the gate working pre-golden)", () => {
    const rows = [...BASE_ROWS, legacyDscr("DSCR", 2.026), legacyDscr("DSCR_STRESSED_300BPS", 1.402)];
    const { report } = runDecisionCoreShadow(DEAL, rows);
    assert.equal(report.unexpected, 2);
    assert.equal(report.cutoverBlocked, true);
    for (const d of report.divergences) assert.ok(DECISION_CORE_OVERLAPPING.has(d.factKey));
  });

  it("[dcs-4] stressed DSCR gates independently — base ZERO, stressed UNEXPECTED → blocked", () => {
    const rows = [...BASE_ROWS, legacyDscr("DSCR", FIN_DSCR), legacyDscr("DSCR_STRESSED_300BPS", 1.402)];
    const { report } = runDecisionCoreShadow(DEAL, rows);
    assert.equal(report.zero, 1);
    assert.equal(report.unexpected, 1);
    assert.equal(report.cutoverBlocked, true);
    const stressed = report.divergences.find((d) => d.factKey === "DSCR_STRESSED_300BPS");
    assert.equal(stressed!.classification, "UNEXPECTED");
  });
});

describe("[dcs] decision-core shadow — key alignment (R3)", () => {
  it("[dcs-5] legacy DEAL/period keys join the finengine side — a real pair, not all-shadow-only", () => {
    const rows = [...BASE_ROWS, legacyDscr("DSCR", 2.026), legacyDscr("DSCR_STRESSED_300BPS", 1.402)];
    const { report } = runDecisionCoreShadow(DEAL, rows);
    assert.equal(report.total, 2); // two pairs, not four shadow-only + legacy-only entries
    for (const d of report.divergences) {
      assert.equal(d.ownerType, "DEAL");
      assert.equal(d.fiscalPeriodEnd, DECISION_PERIOD);
      assert.ok(d.legacyValue != null && d.newValue != null); // both sides present (true diff)
    }
  });

  it("[dcs-6] legacy DSCR absent → reported as legacy-missing (warning), not gated, no crash", () => {
    const { report, warnings, globalDSCR } = runDecisionCoreShadow(DEAL, BASE_ROWS);
    assert.equal(report.total, 0); // nothing to gate
    assert.ok(globalDSCR != null); // finengine value still produced
    assert.ok(warnings.some((w) => /legacy DSCR missing/.test(w)));
  });
});

describe("[dcs] decision-core shadow — stress mapping", () => {
  it("[dcs-7] StressInputs use the +12% fallback; stressed DSCR = globalCash / (globalDS × 1.12)", () => {
    const { result } = runGlobalCashFlowShadow(DEAL, BASE_ROWS);
    const stress = buildStressInputs(DEAL, BASE_ROWS, "2024-12-31", result.globalCashBeforeDebt, result.globalDebtService);
    assert.equal(stress.stressedDsPath, "fallback_12pct");
    assert.equal(stress.stressInputs.debtServiceStressed300, undefined);
    const expected = result.globalCashBeforeDebt / (result.globalDebtService * 1.12);
    assert.ok(Math.abs(rateShock(stress.stressInputs).dscr! - expected) < 1e-9);
    // grossMargin resolved from GROSS_PROFIT / revenue.
    assert.ok(Math.abs(stress.stressInputs.grossMarginPct - 3533599 / 28767069) < 1e-9);
  });
});

describe("[dcs] decision-core shadow — net-new never gates (firewall)", () => {
  it("[dcs-8] the report contains ONLY DECISION_CORE_OVERLAPPING keys", () => {
    const rows = [...BASE_ROWS, legacyDscr("DSCR", 2.026), legacyDscr("DSCR_STRESSED_300BPS", 1.402)];
    const { report } = runDecisionCoreShadow(DEAL, rows);
    for (const d of report.divergences) {
      assert.ok(DECISION_CORE_OVERLAPPING.has(d.factKey), `${d.factKey} must be an overlapping decision number`);
    }
    // Intermediates / net-new finengine outputs never appear in the gated report.
    for (const k of ["CASH_FLOW_AVAILABLE", "PROPOSED_LOAN_COVERAGE", "EXCESS_CASH_FLOW", "singleCountVerified", "globalCashBeforeDebt"]) {
      assert.ok(!report.divergences.some((d) => d.factKey === k));
    }
  });
});
