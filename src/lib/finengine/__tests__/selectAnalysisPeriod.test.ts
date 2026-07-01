/**
 * SPEC-FINENGINE-ANALYSIS-PERIOD-SELECTION-1 — analysis-period selection tests.
 *
 * The bug: the assembler picked the latest NON-sentinel business period, which on
 * OmniCare is an AR-aging date (`2026-04-28`) with ZERO income facts → EBITDA 0 →
 * a fake global DSCR. The fix selects the latest INCOME-BEARING, FULL-ANNUAL-CYCLE
 * period via a shared pure helper the assembler AND the golden both import, so the
 * corrected number stays INTENDED (R1).
 *
 * Pure: no DB; runs under `node --test --import tsx`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  selectAnalysisPeriod,
  periodDaysFromSnapshot,
} from "@/lib/finengine/shadow/selectAnalysisPeriod";
import { SENTINEL_PERIOD, type CertifiedPeriodSnapshot, type CertifiedFactRow } from "@/lib/finengine/shadow/dealInputAdapter";
import { buildGlobalCashFlowInputs } from "@/lib/finengine/shadow/globalCashFlowAdapter";
import { decisionCoreGoldenSet, goldenGlobalDscr } from "@/lib/finengine/shadow/decisionCoreGoldenSet";
import { runDecisionCoreShadow } from "@/lib/finengine/shadow/runDecisionCoreShadow";

const DEAL = "eefd62b3-4ae2-4d43-bb80-9953fdca9bcc";

/** Build a business snapshot literal. `start` null ⇒ duration unknown (R2 path). */
function snap(
  fiscalPeriodEnd: string,
  fiscalPeriodStart: string | null,
  facts: Record<string, number | null>,
): CertifiedPeriodSnapshot {
  return { dealId: DEAL, entityScope: "BUSINESS", fiscalPeriodEnd, fiscalPeriodStart, facts, certified: {}, warnings: [] };
}

const income = (v: number) => ({ M1_TAXABLE_INCOME: v, DEPRECIATION: 0 });
const arAging = { AR_0_30_DAYS: 5000, AR_31_60_DAYS: 2000, AR_OVER_90_DAYS: 1000 }; // no income base

// ── pure unit ──────────────────────────────────────────────────────────────
describe("[sap] selectAnalysisPeriod — pure policy", () => {
  it("[sap-1] OmniCare shape → latest income-bearing ANNUAL period (excludes AR-aging AND the stub)", () => {
    const snaps = [
      snap("2024-12-31", "2024-01-01", income(500_000)), // annual
      snap("2025-12-31", "2025-01-01", income(800_000)), // annual — latest annual
      snap("2026-03-31", "2026-01-01", income(150_000)), // stub (89d) — excluded by duration
      snap("2026-04-28", "2026-04-28", arAging), // AR-aging — excluded by income predicate
      snap(SENTINEL_PERIOD, null, income(999_999)), // sentinel — excluded
    ];
    const sel = selectAnalysisPeriod(snaps, periodDaysFromSnapshot);
    assert.equal(sel.period, "2025-12-31");
    assert.equal(sel.basis, "annual");
    assert.equal(sel.warning, undefined); // duration known → no R2 warning
  });

  it("[sap-2] stub fallback: only sub-annual income periods → latest stub, basis stub-fallback + warning", () => {
    const snaps = [
      snap("2026-03-31", "2026-01-01", income(150_000)), // 89d
      snap("2026-04-28", "2026-04-28", arAging), // no income
    ];
    const sel = selectAnalysisPeriod(snaps, periodDaysFromSnapshot);
    assert.equal(sel.period, "2026-03-31");
    assert.equal(sel.basis, "stub-fallback");
    assert.ok(/sub-annual|NOT annualized/.test(sel.warning ?? ""));
  });

  it("[sap-3] none: no income-bearing business period → basis none + warning (caller treats cash as 0)", () => {
    const snaps = [snap("2026-04-28", "2026-04-28", arAging)];
    const sel = selectAnalysisPeriod(snaps, periodDaysFromSnapshot);
    assert.equal(sel.basis, "none");
    assert.equal(sel.period, SENTINEL_PERIOD);
    assert.ok(/no income-bearing/.test(sel.warning ?? ""));
  });

  it("[sap-4] zero-but-resolved: an annual base that resolves to 0 is still a valid period", () => {
    // predicate is "base resolves", NOT "EBITDA ≠ 0".
    const snaps = [snap("2025-12-31", "2025-01-01", { ORDINARY_BUSINESS_INCOME: 0 })];
    const sel = selectAnalysisPeriod(snaps, periodDaysFromSnapshot);
    assert.equal(sel.period, "2025-12-31");
    assert.equal(sel.basis, "annual");
  });

  it("[sap-5] override wins verbatim, basis annual, unchecked", () => {
    const snaps = [snap("2025-12-31", "2025-01-01", income(800_000))];
    const sel = selectAnalysisPeriod(snaps, periodDaysFromSnapshot, { analysisPeriod: "2099-01-01" });
    assert.equal(sel.period, "2099-01-01");
    assert.equal(sel.basis, "annual");
  });

  it("[sap-6 — R2] missing period-start on a Dec-31 income period → admitted annual, WARNED (not silently demoted)", () => {
    const snaps = [
      snap("2024-12-31", null, income(500_000)), // annual by year-end heuristic
      snap("2025-12-31", null, income(800_000)), // latest annual by year-end heuristic
    ];
    const sel = selectAnalysisPeriod(snaps, periodDaysFromSnapshot);
    assert.equal(sel.period, "2025-12-31");
    assert.equal(sel.basis, "annual");
    assert.ok(/fiscal-year-end|Dec-31|no period-start/.test(sel.warning ?? ""));
  });

  it("[sap-7] a non-year-end period with unknown duration is NOT admitted as annual", () => {
    // start null + not Dec-31 → cannot verify annual → falls to stub-fallback.
    const snaps = [snap("2026-06-30", null, income(150_000))];
    const sel = selectAnalysisPeriod(snaps, periodDaysFromSnapshot);
    assert.equal(sel.basis, "stub-fallback");
    assert.equal(sel.period, "2026-06-30");
  });
});

// ── OmniCare-shaped fixture for the integration + alignment tests ────────────
const GEM = "gemini_primary_v1";
const DECISION_PERIOD = "2026-06-29";
function r(fact_key: string, period: string, start: string | null, value: number, sct: string | null, owner: string): CertifiedFactRow {
  return { fact_key, fact_period_end: period, fact_period_start: start, fact_value_num: value, source_canonical_type: sct, owner_type: owner, confidence: 0.8, extractor: GEM, is_superseded: false, created_at: "2026-06-01T00:00:00Z" };
}
const is_ = (k: string, p: string, s: string, v: number) => r(k, p, s, v, "INCOME_STATEMENT", "DEAL");
const btr = (k: string, p: string, s: string, v: number) => r(k, p, s, v, "BUSINESS_TAX_RETURN", "DEAL");
const ar = (k: string, p: string, v: number) => r(k, p, p, v, "AR_AGING", "DEAL");
const ptr = (k: string, p: string, v: number) => r(k, p, p, v, "PERSONAL_TAX_RETURN", "DEAL");
const PFS_PERIOD = "2025-10-07";
const pfs = (k: string, v: number) => r(k, PFS_PERIOD, PFS_PERIOD, v, "PFS", "PERSONAL");
const dealFact = (k: string, v: number) => r(k, DECISION_PERIOD, DECISION_PERIOD, v, null, "DEAL");

// 2025 annual EBITDA = 800000 + 257974 = 1,057,974 (matches the live V-2 target).
const EBITDA_2025 = 800_000 + 257_974;
const OMNICARE_ROWS: CertifiedFactRow[] = [
  // 2025 annual income statement — the CORRECT analysis period.
  is_("M1_TAXABLE_INCOME", "2025-12-31", "2025-01-01", 800_000),
  is_("DEPRECIATION", "2025-12-31", "2025-01-01", 257_974),
  is_("TOTAL_REVENUE", "2025-12-31", "2025-01-01", 28_767_069),
  is_("GROSS_PROFIT", "2025-12-31", "2025-01-01", 3_533_599),
  // 2024 older annual tax return.
  btr("M1_TAXABLE_INCOME", "2024-12-31", "2024-01-01", 200_925),
  btr("DEPRECIATION", "2024-12-31", "2024-01-01", 210_207),
  // 2026 Q1 stub income statement (89 days) — income-bearing but sub-annual.
  is_("M1_TAXABLE_INCOME", "2026-03-31", "2026-01-01", 120_000),
  // 2026-04-28 AR-aging — the buggy old pick (no income).
  ar("AR_0_30_DAYS", "2026-04-28", 5_000),
  ar("AR_OVER_90_DAYS", "2026-04-28", 1_000),
  // Deal-level debt service.
  dealFact("ANNUAL_DEBT_SERVICE", 101_250),
  dealFact("ANNUAL_DEBT_SERVICE_PROPOSED", 101_250),
  // Personal side.
  ptr("WAGES_W2", "2025-12-31", 310_000),
  pfs("PFS_SALARY_WAGES", 250_000),
  pfs("PFS_ANNUAL_DEBT_SERVICE", 19_800),
  pfs("PFS_LIVING_EXPENSES", 19_800),
];

describe("[sap] analysis-period selection — assembler integration", () => {
  it("[sap-8] assembler picks the 2025 annual period, real business EBITDA (NOT the AR-aging 0)", () => {
    const inputs = buildGlobalCashFlowInputs(DEAL, OMNICARE_ROWS);
    assert.equal(inputs.analysisPeriod, "2025-12-31");
    assert.equal(inputs.analysisPeriodBasis, "annual");
    assert.equal(inputs.business[0].operatingCashFlow, EBITDA_2025); // 1,057,974 — not 0
    assert.notEqual(inputs.business[0].operatingCashFlow, 0);
    // no "EBITDA unresolved" warning — the period carries income.
    assert.ok(!inputs.warnings.some((w) => /EBITDA unresolved/.test(w)));
  });
});

describe("[sap] analysis-period selection — golden/engine alignment (R1)", () => {
  it("[sap-9] golden and assembler select the SAME period → DSCR/stressed INTENDED, cutoverBlocked=false", () => {
    // Golden picks its period internally via the SAME shared helper as the engine.
    assert.ok(goldenGlobalDscr(DEAL, OMNICARE_ROWS).value != null);
    const golden = decisionCoreGoldenSet(DEAL, OMNICARE_ROWS);
    assert.equal(golden.length, 2);

    const rows = [
      ...OMNICARE_ROWS,
      r("DSCR", DECISION_PERIOD, DECISION_PERIOD, 2.026, null, "DEAL"),
      r("DSCR_STRESSED_300BPS", DECISION_PERIOD, DECISION_PERIOD, 1.402, null, "DEAL"),
    ];
    const { report, analysisPeriod, analysisPeriodBasis, globalDSCR } = runDecisionCoreShadow(DEAL, rows);
    assert.equal(analysisPeriod, "2025-12-31");
    assert.equal(analysisPeriodBasis, "annual");
    assert.equal(report.cutoverBlocked, false);
    assert.equal(report.unexpected, 0);
    assert.equal(report.intended, 2);
    // a REAL global DSCR driven by business + personal (not the personal-only artifact).
    assert.ok(globalDSCR != null && Number.isFinite(globalDSCR));
  });
});

describe("[sap] analysis-period selection — NG2 import firewall", () => {
  it("[sap-10] the helper imports NO engine spread (pure selection policy)", () => {
    const src = readFileSync(fileURLToPath(new URL("../shadow/selectAnalysisPeriod.ts", import.meta.url)), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/dealSpread/.test(code), "must NOT import dealSpread (NG2)");
    assert.ok(!/computeGlobalCashFlow/.test(code), "must NOT import computeGlobalCashFlow (NG2)");
    assert.ok(!/stressEngine/.test(code), "must NOT import the stress engine (NG2)");
  });
});
