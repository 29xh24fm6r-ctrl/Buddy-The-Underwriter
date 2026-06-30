/**
 * SPEC-FINENGINE-FULL-SPREAD-SHADOW-1 — full-spread shadow harness tests.
 *
 * Gating correctness (the crux) + completeness + the net-new firewall. Uses the
 * proven 2-period OmniCare business fixture (mirrors dealSpread.test.ts) so the
 * full credit-measurement universe is exercised on realistic line items.
 *
 * Pure: runFullSpreadShadow imports only computeDealSpread + reconcile + the
 * adapter (no server-only, no DB), so it runs under `node --test --import tsx`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  runFullSpreadShadow,
  OVERLAPPING_METRICS,
} from "@/lib/finengine/shadow/runFullSpreadShadow";
import type { GoldenSetEntry } from "@/lib/finengine/shadow/reconcile";
import type { CertifiedFactRow } from "@/lib/finengine/shadow/dealInputAdapter";

const DEAL = "80fe6f7a-5c68-4f02-8bcf-933f246a9fc5";
const GEM = "gemini_primary_v1";
const DET = "taxReturnExtractor:v2:deterministic";

function r(fact_key: string, period: string, value: number, sct: string, owner: string, conf: number, ext: string): CertifiedFactRow {
  return { fact_key, fact_period_end: period, fact_value_num: value, source_canonical_type: sct, owner_type: owner, confidence: conf, extractor: ext, is_superseded: false, created_at: "2026-06-01T00:00:00Z" };
}
const biz = (k: string, p: string, v: number, conf = 0.8, ext = GEM) => r(k, p, v, "BUSINESS_TAX_RETURN", "DEAL", conf, ext);

/** Base income-statement + balance-sheet rows (no legacy EBITDA / ratio facts). */
const BASE_ROWS: CertifiedFactRow[] = [
  biz("GROSS_RECEIPTS", "2023-12-31", 15088769), biz("GROSS_RECEIPTS", "2024-12-31", 28767069),
  biz("COST_OF_GOODS_SOLD", "2023-12-31", 13292890), biz("COST_OF_GOODS_SOLD", "2024-12-31", 25233470),
  biz("GROSS_PROFIT", "2023-12-31", 1472421), biz("GROSS_PROFIT", "2024-12-31", 3533599),
  biz("NET_INCOME", "2023-12-31", -457567), biz("NET_INCOME", "2024-12-31", 0),
  biz("M1_TAXABLE_INCOME", "2023-12-31", -457567), biz("M1_TAXABLE_INCOME", "2024-12-31", 200925),
  biz("DEPRECIATION", "2023-12-31", 61656), biz("DEPRECIATION", "2024-12-31", 210207),
  biz("OFFICER_COMPENSATION", "2023-12-31", 200000), biz("OFFICER_COMPENSATION", "2024-12-31", 310000),
  biz("TOTAL_CURRENT_ASSETS", "2023-12-31", 2950000), biz("TOTAL_CURRENT_ASSETS", "2024-12-31", 6800000),
  biz("TOTAL_CURRENT_LIABILITIES", "2023-12-31", 1773043), biz("TOTAL_CURRENT_LIABILITIES", "2024-12-31", 1500000),
  biz("SL_INVENTORY", "2023-12-31", 120000), biz("SL_INVENTORY", "2024-12-31", 180000),
  biz("SL_ACCOUNTS_PAYABLE", "2023-12-31", 900000), biz("SL_ACCOUNTS_PAYABLE", "2024-12-31", 1100000),
  biz("SL_TOTAL_ASSETS", "2023-12-31", 3003718), biz("SL_TOTAL_ASSETS", "2024-12-31", 6800000),
  biz("SL_TOTAL_EQUITY", "2023-12-31", 1230675), biz("SL_TOTAL_EQUITY", "2024-12-31", 6800000),
  biz("SL_TOTAL_LIABILITIES", "2023-12-31", 1773043), biz("SL_TOTAL_LIABILITIES", "2024-12-31", 1500000),
  biz("SL_RETAINED_EARNINGS", "2023-12-31", 1230675), biz("SL_RETAINED_EARNINGS", "2024-12-31", 4512938),
  biz("SL_CASH", "2023-12-31", 142463), biz("SL_CASH", "2024-12-31", 401558),
  biz("SL_AR_GROSS", "2023-12-31", 2805001), biz("SL_AR_GROSS", "2024-12-31", 6398442),
];

/** Read the engine's EBITDA cells (scope, period, value) for a row set. */
function engineEbitdaCells(rows: CertifiedFactRow[]): Array<{ scope: string; period: string; value: number }> {
  const { spread } = runFullSpreadShadow(DEAL, rows);
  return spread.cells
    .filter((c) => c.metric === "EBITDA" && c.value != null)
    .map((c) => ({ scope: c.scope, period: c.period, value: c.value! }));
}

/** Build legacy EBITDA fact rows matching (scope→source) each engine EBITDA cell, optionally perturbed. */
function legacyEbitdaRows(cells: Array<{ scope: string; period: string; value: number }>, delta = 0): CertifiedFactRow[] {
  // scopeOf("BUSINESS_TAX_RETURN") = BUSINESS, so a BUSINESS_TAX_RETURN-sourced row
  // normalizes to the same EntityScope the engine cell carries.
  return cells.map((c) => biz("EBITDA", c.period, c.value + delta));
}

describe("[fss] full-spread shadow — gating correctness (the crux)", () => {
  it("[fss-1] overlapping EBITDA matches legacy → report ZERO, cutoverBlocked=false", () => {
    const cells = engineEbitdaCells(BASE_ROWS);
    assert.ok(cells.length >= 1, "engine emits at least one EBITDA cell");
    const rows = [...BASE_ROWS, ...legacyEbitdaRows(cells, 0)];

    const { report } = runFullSpreadShadow(DEAL, rows);
    assert.equal(report.cutoverBlocked, false);
    assert.equal(report.unexpected, 0);
    assert.equal(report.zero, report.total);
    assert.ok(report.total >= 1, "EBITDA divergence(s) present and classified ZERO");
  });

  it("[fss-2] overlapping EBITDA diverges WITH a matching golden → INTENDED, not blocked", () => {
    const cells = engineEbitdaCells(BASE_ROWS);
    const rows = [...BASE_ROWS, ...legacyEbitdaRows(cells, 1_000_000)]; // legacy off by $1M
    const goldenSet: GoldenSetEntry[] = cells.map((c) => ({
      dealId: DEAL,
      factKey: "EBITDA",
      ownerType: c.scope,
      fiscalPeriodEnd: c.period,
      expectedNewValue: c.value, // the finengine value is the intended post-fix value
      rationale: "test golden — finengine EBITDA is the corrected value",
      spec: "SPEC-FINENGINE-FULL-SPREAD-SHADOW-1",
    }));

    const { report } = runFullSpreadShadow(DEAL, rows, goldenSet);
    assert.equal(report.cutoverBlocked, false);
    assert.equal(report.unexpected, 0);
    assert.equal(report.intended, report.total);
    assert.ok(report.intended >= 1);
  });

  it("[fss-3] overlapping EBITDA diverges with NO golden → UNEXPECTED, cutoverBlocked=true", () => {
    const cells = engineEbitdaCells(BASE_ROWS);
    const rows = [...BASE_ROWS, ...legacyEbitdaRows(cells, 1_000_000)];

    const { report } = runFullSpreadShadow(DEAL, rows, []);
    assert.equal(report.cutoverBlocked, true);
    assert.ok(report.unexpected >= 1);
    for (const d of report.divergences.filter((x) => x.classification === "UNEXPECTED")) {
      assert.equal(d.factKey, "EBITDA"); // only an overlapping key can be UNEXPECTED
    }
  });

  it("[fss-4 — LOAD-BEARING] a net-new ratio with a legacy counterpart NEVER gates (§0.2 trap / R1)", () => {
    // Plant a legacy CURRENT_RATIO fact wildly different from the engine's value AND
    // keep EBITDA matching so the only possible block source would be the net-new
    // ratio leaking into the gate. It must NOT: CURRENT_RATIO ∉ OVERLAPPING_METRICS.
    const cells = engineEbitdaCells(BASE_ROWS);
    const rows = [
      ...BASE_ROWS,
      ...legacyEbitdaRows(cells, 0), // EBITDA agrees → no overlapping divergence
      biz("CURRENT_RATIO", "2023-12-31", 999.0), // legacy ratio fact, absurd value
      biz("CURRENT_RATIO", "2024-12-31", 999.0),
    ];

    const { report, additiveMetrics } = runFullSpreadShadow(DEAL, rows);

    // The gate is clean — the absurd CURRENT_RATIO never entered it.
    assert.equal(report.cutoverBlocked, false);
    assert.equal(report.unexpected, 0);
    // CURRENT_RATIO appears nowhere in the gated report …
    assert.ok(report.divergences.every((d) => d.factKey !== "CURRENT_RATIO"));
    // … and IS surfaced (with the engine's real value, not the legacy 999) as additive.
    const cr = additiveMetrics.find((m) => m.metric === "CURRENT_RATIO" && m.period === "2023-12-31");
    assert.ok(cr, "CURRENT_RATIO present in additiveMetrics");
    assert.notEqual(cr!.value, 999.0);
  });
});

describe("[fss] full-spread shadow — completeness + firewall", () => {
  it("[fss-5] every metric family is represented in additiveMetrics", () => {
    const { additiveMetrics } = runFullSpreadShadow(DEAL, BASE_ROWS);
    const fams = new Set(additiveMetrics.map((m) => m.family));
    for (const f of ["liquidity", "leverage", "profitability", "activity", "adjustments", "distress", "structural"]) {
      assert.ok(fams.has(f), `additive family ${f} present`);
    }
    // Every additive cell carries a rating + meaning (the report payload).
    for (const m of additiveMetrics) {
      assert.equal(typeof m.rating, "string");
      assert.equal(typeof m.meaning, "string");
    }
  });

  it("[fss-6 — source guard] report is built ONLY from OVERLAPPING_METRICS; additive excludes them", () => {
    const cells = engineEbitdaCells(BASE_ROWS);
    const rows = [...BASE_ROWS, ...legacyEbitdaRows(cells, 5)]; // small divergence to populate the report
    const { report, additiveMetrics } = runFullSpreadShadow(DEAL, rows);

    // Gated set ⊆ OVERLAPPING_METRICS.
    for (const d of report.divergences) {
      assert.ok(OVERLAPPING_METRICS.has(d.factKey), `report key ${d.factKey} must be overlapping`);
    }
    // Additive set ∩ OVERLAPPING_METRICS = ∅.
    for (const m of additiveMetrics) {
      assert.ok(!OVERLAPPING_METRICS.has(m.metric), `additive key ${m.metric} must not be overlapping`);
    }
    // EBITDA is gated, never additive.
    assert.ok(additiveMetrics.every((m) => m.metric !== "EBITDA"));
  });

  it("[fss-7] legacy owner_type normalizes to EntityScope so the join is non-empty (R3)", () => {
    const cells = engineEbitdaCells(BASE_ROWS);
    assert.ok(cells.some((c) => c.scope === "BUSINESS"));
    const rows = [...BASE_ROWS, ...legacyEbitdaRows(cells, 0)];
    const { report } = runFullSpreadShadow(DEAL, rows);
    // A non-empty report proves the BUSINESS_TAX_RETURN/"DEAL" legacy rows joined to
    // the engine's BUSINESS-scoped EBITDA cells (raw owner_type "DEAL" would not have).
    assert.ok(report.total >= 1);
    assert.ok(report.divergences.every((d) => d.ownerType === "BUSINESS"));
  });
});
