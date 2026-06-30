/**
 * SPEC-FINENGINE-DECISION-CORE-GOLDEN-1 — decision-core golden-set registry tests.
 *
 * Proves the registry registers the corrected global DSCR + Stress C as INTENDED from
 * INDEPENDENT derivations (NG2), that the harness self-classifies them INTENDED out of
 * the box, that the golden binds the SPECIFIC fix (teeth intact), and that the golden
 * value equals the harness/engine value by construction (two paths concur).
 *
 * Pure: no DB; runs under `node --test --import tsx`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  decisionCoreGoldenSet,
  goldenGlobalDscr,
  goldenStressCDscr,
} from "@/lib/finengine/shadow/decisionCoreGoldenSet";
import { runDecisionCoreShadow } from "@/lib/finengine/shadow/runDecisionCoreShadow";
import type { CertifiedFactRow } from "@/lib/finengine/shadow/dealInputAdapter";

const DEAL = "eefd62b3-4ae2-4d43-bb80-9953fdca9bcc";
const GEM = "gemini_primary_v1";
const DECISION_PERIOD = "2026-06-29";

function r(fact_key: string, period: string, value: number, sct: string | null, owner: string): CertifiedFactRow {
  return { fact_key, fact_period_end: period, fact_value_num: value, source_canonical_type: sct, owner_type: owner, confidence: 0.8, extractor: GEM, is_superseded: false, created_at: "2026-06-01T00:00:00Z" };
}
const biz = (k: string, p: string, v: number) => r(k, p, v, "BUSINESS_TAX_RETURN", "DEAL");
const ptr = (k: string, p: string, v: number) => r(k, p, v, "PERSONAL_TAX_RETURN", "DEAL");
const pfs = (k: string, p: string, v: number) => r(k, p, v, "PFS", "PERSONAL");
const dealFact = (k: string, p: string, v: number) => r(k, p, v, null, "DEAL");
const legacyDscr = (k: string, v: number) => r(k, DECISION_PERIOD, v, null, "DEAL");

// OmniCare-shaped C-corp fixture (independent EBITDA == engine EBITDA at 2024 = 411132).
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

// Hand-computed independent expectations:
//   businessEBITDA = 200925 + 210207 = 411132
//   personalIncome = wages 310000 (+ rental 0 + investment 0); living 19800
//   globalCash = 411132 + (310000 - 19800) = 701332
//   globalDS   = (101250 + 101250) + 19800 = 222300
//   globalDSCR = 701332 / 222300
const EXPECT_GLOBAL_CASH = 411132 + (310000 - 19800);
const EXPECT_GLOBAL_DS = 202500 + 19800;
const EXPECT_DSCR = EXPECT_GLOBAL_CASH / EXPECT_GLOBAL_DS;
const MARGIN = 3533599 / 28767069;
const EXPECT_STRESSED = (EXPECT_GLOBAL_CASH - 28767069 * 0.15 * MARGIN) / (EXPECT_GLOBAL_DS * 1.12);

describe("[dcg] decision-core golden — independent derivations (NG2)", () => {
  it("[dcg-1] goldenGlobalDscr = hand-computed global DSCR (corrected denominator; income excl. K-1/dist)", () => {
    const g = goldenGlobalDscr(DEAL, BASE_ROWS);
    assert.ok(g.value != null);
    assert.ok(Math.abs(g.value! - EXPECT_DSCR) < 1e-9);
    // Income excludes K-1 / distributions even when present.
    const withNoise = [...BASE_ROWS, ptr("K1_ORDINARY_INCOME", "2024-12-31", 1041), biz("M2_DISTRIBUTIONS", "2024-12-31", 50000)];
    const g2 = goldenGlobalDscr(DEAL, withNoise);
    assert.ok(Math.abs(g2.value! - EXPECT_DSCR) < 1e-9); // unchanged — single-count holds
  });

  it("[dcg-2] goldenStressCDscr = hand-computed Stress C (−15% revenue & +12% DS on the global base)", () => {
    const s = goldenStressCDscr(DEAL, BASE_ROWS);
    assert.ok(s.value != null);
    assert.ok(Math.abs(s.value! - EXPECT_STRESSED) < 1e-9);
    assert.ok(s.value! < EXPECT_DSCR); // stressed is more conservative
  });

  it("[dcg-3] decisionCoreGoldenSet emits one entry per overlapping key, matched by dealId+factKey", () => {
    const golden = decisionCoreGoldenSet(DEAL, BASE_ROWS);
    assert.equal(golden.length, 2);
    const keys = golden.map((g) => g.factKey).sort();
    assert.deepEqual(keys, ["DSCR", "DSCR_STRESSED_300BPS"]);
    for (const g of golden) {
      assert.equal(g.ownerType, undefined); // omitted → matches the harness's DEAL-keyed shadow value
      assert.equal(g.fiscalPeriodEnd, undefined);
      assert.equal(g.spec, "SPEC-FINENGINE-DECISION-CORE-GOLDEN-1");
    }
  });

  it("[dcg-4 — NG2] golden tracks the FACTS — perturbing depreciation moves the golden, independent of the engine", () => {
    const base = goldenGlobalDscr(DEAL, BASE_ROWS).value!;
    const perturbed = BASE_ROWS.map((row) =>
      row.fact_key === "DEPRECIATION" ? { ...row, fact_value_num: 210207 + 222300 } : row,
    );
    const moved = goldenGlobalDscr(DEAL, perturbed).value!;
    // +222300 EBITDA over a 222300 denominator ⇒ DSCR rises by exactly 1.0.
    assert.ok(Math.abs((moved - base) - 1.0) < 1e-9);
  });

  it("[dcg-5] unresolved denominator (no debt service) ⇒ no entry (stays UNEXPECTED, not papered over)", () => {
    const noDs = BASE_ROWS.filter((r) => !r.fact_key.startsWith("ANNUAL_DEBT_SERVICE") && r.fact_key !== "PFS_ANNUAL_DEBT_SERVICE");
    assert.equal(decisionCoreGoldenSet(DEAL, noDs).length, 0);
  });
});

describe("[dcg] decision-core golden — end-to-end via the harness (registry default)", () => {
  it("[dcg-6] legacy bugged denominator vs finengine fix → DSCR + stressed INTENDED, cutoverBlocked=false", () => {
    const rows = [...BASE_ROWS, legacyDscr("DSCR", 2.026), legacyDscr("DSCR_STRESSED_300BPS", 1.402)];
    const { report } = runDecisionCoreShadow(DEAL, rows); // omit goldenSet → registry default
    assert.equal(report.cutoverBlocked, false);
    assert.equal(report.unexpected, 0);
    assert.equal(report.intended, 2);
    for (const d of report.divergences) {
      assert.equal(d.classification, "INTENDED");
      assert.ok((d.note ?? "").includes("SPEC-FINENGINE-DECISION-CORE-GOLDEN-1"));
    }
  });

  it("[dcg-7 — teeth] a finengine value drifted off the registered golden stays UNEXPECTED", () => {
    // Register the golden for the correct facts, then run on facts where the proposed
    // loan is inflated so the engine DSCR drifts off the registered value.
    const registered = decisionCoreGoldenSet(DEAL, BASE_ROWS);
    const drifted = [
      ...BASE_ROWS.map((row) => (row.fact_key === "ANNUAL_DEBT_SERVICE_PROPOSED" ? { ...row, fact_value_num: 101250 + 500000 } : row)),
      legacyDscr("DSCR", 2.026),
      legacyDscr("DSCR_STRESSED_300BPS", 1.402),
    ];
    const { report } = runDecisionCoreShadow(DEAL, drifted, registered);
    assert.ok(report.unexpected >= 1);
    assert.equal(report.cutoverBlocked, true);
  });

  it("[dcg-8] the registry golden equals the harness/engine value by construction (two paths concur)", () => {
    const { globalDSCR, stressedDSCR } = runDecisionCoreShadow(DEAL, BASE_ROWS);
    assert.ok(Math.abs(goldenGlobalDscr(DEAL, BASE_ROWS).value! - globalDSCR!) < 1e-9);
    assert.ok(Math.abs(goldenStressCDscr(DEAL, BASE_ROWS).value! - stressedDSCR!) < 1e-9);
  });
});

describe("[dcg] decision-core golden — NG2 import firewall", () => {
  it("[dcg-9] the golden module imports the independent derivation, NOT the engine", () => {
    const src = readFileSync(fileURLToPath(new URL("../shadow/decisionCoreGoldenSet.ts", import.meta.url)), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(/goldenConservativeEbitda/.test(code), "must use the independent EBITDA derivation");
    assert.ok(!/computeGlobalCashFlow/.test(code), "must NOT import computeGlobalCashFlow (NG2)");
    assert.ok(!/stressEngine/.test(code), "must NOT import the stress engine (NG2)");
    assert.ok(!/runDecisionCoreShadow/.test(code), "must NOT import the harness (NG2)");
    assert.ok(!/globalCashFlowAdapter/.test(code), "must NOT route through the assembler (engine EBITDA) (NG2)");
  });
});
