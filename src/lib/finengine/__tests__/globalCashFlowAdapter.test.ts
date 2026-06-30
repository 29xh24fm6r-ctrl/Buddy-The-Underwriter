/**
 * SPEC-FINENGINE-GLOBAL-CASHFLOW-ASSEMBLER-1 — global cash flow assembler tests.
 *
 * Mapping correctness on an OmniCare-shaped fixture, the single-count wall (K-1 Box 1
 * and distributions NEVER enter personal income — the load-bearing guard), graceful
 * degradation, NG3 period discipline, and a source-grep guard on the income mapping.
 *
 * Pure: the assembler imports no DB; runs under `node --test --import tsx`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  buildGlobalCashFlowInputs,
  runGlobalCashFlowShadow,
} from "@/lib/finengine/shadow/globalCashFlowAdapter";
import type { CertifiedFactRow } from "@/lib/finengine/shadow/dealInputAdapter";

const DEAL = "eefd62b3-4ae2-4d43-bb80-9953fdca9bcc";
const GEM = "gemini_primary_v1";

function row(fact_key: string, period: string, value: number, sct: string, owner: string): CertifiedFactRow {
  return { fact_key, fact_period_end: period, fact_value_num: value, source_canonical_type: sct, owner_type: owner, confidence: 0.8, extractor: GEM, is_superseded: false, created_at: "2026-06-01T00:00:00Z" };
}
const biz = (k: string, p: string, v: number) => row(k, p, v, "BUSINESS_TAX_RETURN", "DEAL");
const ptr = (k: string, p: string, v: number) => row(k, p, v, "PERSONAL_TAX_RETURN", "DEAL");
const pfs = (k: string, p: string, v: number) => row(k, p, v, "PFS", "PERSONAL");
const deal = (k: string, p: string, v: number) => row(k, p, v, null as unknown as string, "DEAL");

// EBITDA(2024) = M1_TAXABLE_INCOME 200925 + DEPRECIATION 210207 = 411132 (independent).
const BIZ_DS = 101250, PROP_DS = 101250; // sum → 202500
const W2_2024 = 310000, RENT_GROSS = 5000, K1 = 1041, DIST = 50000;
const PFS_SALARY = 250000, PFS_DS = 19800, PFS_LIVING = 19800;

const ROWS: CertifiedFactRow[] = [
  // Business income (2024)
  biz("M1_TAXABLE_INCOME", "2024-12-31", 200925),
  biz("DEPRECIATION", "2024-12-31", 210207),
  biz("GROSS_RECEIPTS", "2024-12-31", 28767069),
  // Deal-level debt service + distributions
  deal("ANNUAL_DEBT_SERVICE", "2026-06-29", BIZ_DS),
  deal("ANNUAL_DEBT_SERVICE_PROPOSED", "2026-06-29", PROP_DS),
  biz("M2_DISTRIBUTIONS", "2024-12-31", DIST),
  // Personal tax income (2024) — K1 present but MUST be excluded
  ptr("WAGES_W2", "2024-12-31", W2_2024),
  ptr("SCH_E_GROSS_RENTS_RECEIVED", "2024-12-31", RENT_GROSS),
  ptr("K1_ORDINARY_INCOME", "2024-12-31", K1),
  // PFS (point-in-time, 2025)
  pfs("PFS_SALARY_WAGES", "2025-10-07", PFS_SALARY),
  pfs("PFS_ANNUAL_DEBT_SERVICE", "2025-10-07", PFS_DS),
  pfs("PFS_LIVING_EXPENSES", "2025-10-07", PFS_LIVING),
];

describe("[gcf] global cash flow assembler — mapping correctness", () => {
  it("[gcf-1] analysis period = latest real business period; business node EBITDA + debt service (existing + proposed)", () => {
    const inputs = buildGlobalCashFlowInputs(DEAL, ROWS);
    assert.equal(inputs.analysisPeriod, "2024-12-31");
    assert.equal(inputs.business.length, 1);
    const b = inputs.business[0];
    assert.equal(b.operatingCashFlow, 411132); // independent EBITDA, pre-distribution
    assert.equal(b.businessDebtService, BIZ_DS + PROP_DS); // 202500 — summed, not max'd (R4)
  });

  it("[gcf-2] personal income = wages + netRental + investment; K-1 and distributions EXCLUDED (single-count wall)", () => {
    const inputs = buildGlobalCashFlowInputs(DEAL, ROWS);
    assert.equal(inputs.personal.length, 1);
    const inc = inputs.personal[0].income;
    // Wages (W-2), gross rents (overstated → warned), investment 0.
    assert.equal(inc.wages, W2_2024);
    assert.equal(inc.netRental, RENT_GROSS);
    assert.equal(inc.investment, 0);
    assert.equal(inc.other, 0);
    const incomeSum = inc.wages + inc.netRental + inc.investment + inc.other;
    assert.equal(incomeSum, W2_2024 + RENT_GROSS); // 315000
    // LOAD-BEARING: K-1 Box 1 (1041) and the distribution (50000) are NOT in income.
    assert.notEqual(incomeSum, W2_2024 + RENT_GROSS + K1);
    assert.notEqual(incomeSum, W2_2024 + RENT_GROSS + DIST);
    assert.ok(![inc.wages, inc.netRental, inc.investment, inc.other].includes(K1));
  });

  it("[gcf-3] distribution edge = M2_DISTRIBUTIONS; computeGlobalCashFlow proves singleCountVerified", () => {
    const { inputs, result } = runGlobalCashFlowShadow(DEAL, ROWS);
    const distEdge = inputs.graph.edges.find((e) => e.type === "distribution");
    assert.ok(distEdge);
    assert.equal(distEdge!.amount, DIST);
    assert.equal(distEdge!.from, "business");
    assert.equal(distEdge!.to, "guarantor");
    assert.equal(result.singleCountVerified, true);
    assert.ok(result.ledger.some((l) => l.kind === "distribution" && l.amount === DIST));
  });

  it("[gcf-4] global debt service = business (incl. proposed) + personal guarantees (corrected denominator)", () => {
    const { result } = runGlobalCashFlowShadow(DEAL, ROWS);
    assert.equal(result.globalDebtService, BIZ_DS + PROP_DS + PFS_DS); // 222300
    // Global DSCR is computed and finite.
    assert.ok(result.globalDSCR != null && Number.isFinite(result.globalDSCR));
  });
});

describe("[gcf] global cash flow assembler — degradation (warn, never crash)", () => {
  it("[gcf-5] missing PFS_LIVING_EXPENSES → living expenses degrade to none/0 with a warning", () => {
    const rows = ROWS.filter((r) => r.fact_key !== "PFS_LIVING_EXPENSES");
    const { inputs, result } = runGlobalCashFlowShadow(DEAL, rows);
    assert.equal(inputs.personal[0].livingExpenses.stated ?? null, null);
    assert.equal(result.totalLivingExpenses, 0); // worst-of-three → none_available
    assert.ok(inputs.warnings.some((w) => /PFS_LIVING_EXPENSES/.test(w)));
  });

  it("[gcf-6] missing investment + gross-only rental → 0 investment with warnings, rental overstatement flagged", () => {
    const inputs = buildGlobalCashFlowInputs(DEAL, ROWS);
    assert.equal(inputs.personal[0].income.investment, 0);
    assert.ok(inputs.warnings.some((w) => /dividend\/interest/.test(w)));
    assert.ok(inputs.warnings.some((w) => /OVERSTATED/.test(w)));
  });

  it("[gcf-7] no personal facts → business-only global cash flow, no crash", () => {
    const businessOnly = ROWS.filter((r) => r.source_canonical_type !== "PERSONAL_TAX_RETURN" && r.source_canonical_type !== "PFS");
    const { inputs, result } = runGlobalCashFlowShadow(DEAL, businessOnly);
    assert.equal(inputs.personal.length, 0);
    assert.equal(result.personalContribution, 0);
    assert.ok(result.globalDSCR != null); // business debt service still drives it
  });
});

describe("[gcf] global cash flow assembler — NG3 period discipline", () => {
  it("[gcf-8] a W-2 on a DIFFERENT period is NOT borrowed into the analysis period", () => {
    // W-2 only at 2023; the 2024 personal snapshot has rents (so it exists) but no W-2.
    // Wages must fall to PFS_SALARY_WAGES, NOT borrow the 2023 W-2.
    const rows: CertifiedFactRow[] = [
      biz("M1_TAXABLE_INCOME", "2024-12-31", 200925),
      biz("DEPRECIATION", "2024-12-31", 210207),
      deal("ANNUAL_DEBT_SERVICE", "2026-06-29", BIZ_DS),
      deal("ANNUAL_DEBT_SERVICE_PROPOSED", "2026-06-29", PROP_DS),
      ptr("WAGES_W2", "2023-12-31", 999999), // stale year — must NOT be used
      ptr("SCH_E_GROSS_RENTS_RECEIVED", "2024-12-31", RENT_GROSS),
      pfs("PFS_SALARY_WAGES", "2025-10-07", PFS_SALARY),
      pfs("PFS_ANNUAL_DEBT_SERVICE", "2025-10-07", PFS_DS),
      pfs("PFS_LIVING_EXPENSES", "2025-10-07", PFS_LIVING),
    ];
    const inputs = buildGlobalCashFlowInputs(DEAL, rows);
    assert.equal(inputs.analysisPeriod, "2024-12-31");
    assert.notEqual(inputs.personal[0].income.wages, 999999); // the 2023 W-2 was not borrowed
    assert.equal(inputs.personal[0].income.wages, PFS_SALARY); // fell back to PFS salary
    assert.ok(inputs.warnings.some((w) => /no W-2 wages at 2024-12-31/.test(w)));
  });
});

describe("[gcf] global cash flow assembler — source guard (single-count mapping)", () => {
  it("[gcf-9] the assembler never maps K-1 / distributions into income.*", () => {
    const src = readFileSync(
      fileURLToPath(new URL("../shadow/globalCashFlowAdapter.ts", import.meta.url)),
      "utf8",
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // The K-1 ordinary-income source key is NEVER referenced in code.
    assert.ok(!/K1_ORDINARY_INCOME/.test(code), "K1_ORDINARY_INCOME must never be read");
    // The income literal is EXACTLY the four allowed external-income fields.
    assert.ok(
      /income:\s*\{\s*wages,\s*netRental,\s*investment,\s*other:\s*0\s*\}/.test(code),
      "income must be exactly { wages, netRental, investment, other: 0 } — no distributions/k1",
    );
  });
});
