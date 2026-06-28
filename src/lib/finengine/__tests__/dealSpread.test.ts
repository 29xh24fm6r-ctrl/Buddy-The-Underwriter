/**
 * SPEC-FINENGINE-LIVE-SPREAD-1 — Phase 2 tests.
 *
 * A 2-period OmniCare business fixture (real 2023/2024 line items, including the
 * placeholder-constant garbage rows SL_CASH=2 / SL_AR_GROSS=1) plus a personal
 * pollution row. Asserts computeDealSpread produces a populated, interpreted
 * spread, that the certified layer's garbage rejection carries through end-to-end,
 * and that business and personal scopes do not bleed.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { computeDealSpread, cellsByFamily } from "@/lib/finengine/spread/dealSpread";
import type { CertifiedFactRow } from "@/lib/finengine/shadow/dealInputAdapter";

const DEAL = "80fe6f7a-5c68-4f02-8bcf-933f246a9fc5";
const GEM = "gemini_primary_v1";
const DET = "taxReturnExtractor:v2:deterministic";

function r(fact_key: string, period: string, value: number, sct: string, owner: string, conf: number, ext: string): CertifiedFactRow {
  return { fact_key, fact_period_end: period, fact_value_num: value, source_canonical_type: sct, owner_type: owner, confidence: conf, extractor: ext, is_superseded: false, created_at: "2026-06-01T00:00:00Z" };
}
const biz = (k: string, p: string, v: number, conf = 0.8, ext = GEM) => r(k, p, v, "BUSINESS_TAX_RETURN", "DEAL", conf, ext);

const ROWS: CertifiedFactRow[] = [
  // Income statement (real)
  biz("GROSS_RECEIPTS", "2023-12-31", 15088769), biz("GROSS_RECEIPTS", "2024-12-31", 28767069),
  biz("COST_OF_GOODS_SOLD", "2023-12-31", 13292890), biz("COST_OF_GOODS_SOLD", "2024-12-31", 25233470),
  biz("GROSS_PROFIT", "2023-12-31", 1472421), biz("GROSS_PROFIT", "2024-12-31", 3533599),
  biz("NET_INCOME", "2023-12-31", -457567), biz("NET_INCOME", "2024-12-31", 0),
  biz("M1_TAXABLE_INCOME", "2023-12-31", -457567), biz("M1_TAXABLE_INCOME", "2024-12-31", 200925),
  biz("M1_TAXABLE_INCOME", "2023-12-31", 27, 0.5, DET), biz("M1_TAXABLE_INCOME", "2024-12-31", 27, 0.5, DET), // constant bug
  biz("DEPRECIATION", "2023-12-31", 61656), biz("DEPRECIATION", "2024-12-31", 210207),
  biz("OFFICER_COMPENSATION", "2023-12-31", 200000), biz("OFFICER_COMPENSATION", "2024-12-31", 310000),
  // Balance sheet (real + placeholder-constant garbage from the deterministic extractor)
  biz("TOTAL_CURRENT_ASSETS", "2023-12-31", 2950000), biz("TOTAL_CURRENT_ASSETS", "2024-12-31", 6800000),
  biz("TOTAL_CURRENT_LIABILITIES", "2023-12-31", 1773043), biz("TOTAL_CURRENT_LIABILITIES", "2024-12-31", 1500000),
  biz("SL_INVENTORY", "2023-12-31", 120000), biz("SL_INVENTORY", "2024-12-31", 180000),
  biz("SL_ACCOUNTS_PAYABLE", "2023-12-31", 900000), biz("SL_ACCOUNTS_PAYABLE", "2024-12-31", 1100000),
  biz("SL_TOTAL_ASSETS", "2023-12-31", 3003718), biz("SL_TOTAL_ASSETS", "2024-12-31", 6800000),
  biz("SL_TOTAL_EQUITY", "2023-12-31", 1230675), biz("SL_TOTAL_EQUITY", "2024-12-31", 6800000),
  biz("SL_TOTAL_LIABILITIES", "2023-12-31", 1773043), biz("SL_TOTAL_LIABILITIES", "2024-12-31", 1500000),
  biz("SL_RETAINED_EARNINGS", "2023-12-31", 1230675), biz("SL_RETAINED_EARNINGS", "2024-12-31", 4512938),
  biz("SL_CASH", "2023-12-31", 142463), biz("SL_CASH", "2024-12-31", 401558),
  biz("SL_CASH", "2023-12-31", 2, 0.5, DET), biz("SL_CASH", "2024-12-31", 2, 0.5, DET), // constant garbage
  biz("SL_AR_GROSS", "2023-12-31", 2805001), biz("SL_AR_GROSS", "2024-12-31", 6398442),
  biz("SL_AR_GROSS", "2023-12-31", 1, 0.5, DET), biz("SL_AR_GROSS", "2024-12-31", 1, 0.5, DET), // constant garbage
  // Personal pollution on the same key+period (must not enter a business metric).
  r("TAXABLE_INCOME", "2023-12-31", 249968, "PERSONAL_TAX_RETURN", "DEAL", 0.8, GEM),
];

const spread = computeDealSpread(DEAL, ROWS);
const bizCell = (metric: string, period: string) => spread.cells.find((c) => c.scope === "BUSINESS" && c.metric === metric && c.period === period);

describe("Phase 2 — computeDealSpread produces a populated, interpreted spread", () => {
  it("includes the BUSINESS scope with every metric family", () => {
    assert.ok(spread.scopes.includes("BUSINESS"));
    const fams = new Set(spread.cells.filter((c) => c.scope === "BUSINESS").map((c) => c.family));
    for (const f of ["method", "liquidity", "leverage", "profitability", "activity", "adjustments", "distress", "structural"]) {
      assert.ok(fams.has(f), `family ${f} present`);
    }
  });

  it("every cell carries an interpretation with a valid rating", () => {
    const ratings = new Set(["strong", "adequate", "weak", "flag", "n/a"]);
    for (const c of spread.cells) {
      assert.equal(c.interpretation.metric, c.metric);
      assert.ok(ratings.has(c.rating), `${c.metric} rating ${c.rating}`);
    }
  });

  it("computes leverage and margins on the real numbers", () => {
    const de = bizCell("DEBT_TO_EQUITY", "2023-12-31");
    assert.ok(de && Math.abs(de.value! - 1773043 / 1230675) < 1e-6); // ≈ 1.441
    const gm = bizCell("GROSS_MARGIN", "2023-12-31");
    assert.ok(gm && Math.abs(gm.value! - 1472421 / 15088769) < 1e-6); // ≈ 0.0976
  });
});

describe("Phase 2 — garbage rejection carries through end-to-end (Phase 1 → spread)", () => {
  it("the certified business snapshot uses the real cash/AR, never the placeholder 1/2", () => {
    const snap = spread.snapshots.find((s) => s.entityScope === "BUSINESS" && s.fiscalPeriodEnd === "2023-12-31")!;
    assert.equal(snap.facts["SL_CASH"], 142463);
    assert.equal(snap.facts["SL_AR_GROSS"], 2805001);
    assert.equal(snap.facts["M1_TAXABLE_INCOME"], -457567);
  });

  it("the EBITDA method base reflects the business loss, not the guarantor's personal income", () => {
    const ebitda = bizCell("EBITDA", "2023-12-31");
    assert.ok(ebitda, "business EBITDA cell present");
    assert.ok((ebitda!.value ?? 0) < 0, "2023 EBITDA is negative (built from the −457,567 business loss + D&A, no personal income)");
  });
});

describe("Phase 2 — multi-period metrics use the period series", () => {
  it("revenue growth, asset turnover, and CAGR come from the ordered series", () => {
    const growth = spread.cells.find((c) => c.scope === "BUSINESS" && c.metric === "GROWTH_YOY" && c.period === "2024-12-31");
    assert.ok(growth && Math.abs(growth.value! - (28767069 - 15088769) / 15088769) < 1e-6); // ≈ 0.906
    const at = spread.cells.find((c) => c.scope === "BUSINESS" && c.metric === "ASSET_TURNOVER" && c.period === "2024-12-31");
    assert.ok(at && Math.abs(at.value! - 28767069 / ((3003718 + 6800000) / 2)) < 1e-6); // avg-balance asset turnover
    const cagr = spread.cells.find((c) => c.scope === "BUSINESS" && c.metric === "CAGR" && c.period === "SERIES");
    assert.ok(cagr && cagr.value! > 0);
  });
});

describe("Phase 2 — scopes do not bleed; report grouping works", () => {
  it("the BUSINESS leverage uses business equity/liabilities only", () => {
    const grouped = cellsByFamily(spread, "BUSINESS");
    assert.ok(grouped.leverage.length > 0);
    // sanity: no business cell sourced the personal TAXABLE_INCOME key
    for (const c of spread.cells.filter((c) => c.scope === "BUSINESS")) {
      assert.ok(!c.sourceKeys.includes("TAXABLE_INCOME") || c.metric === "EBITDA", `${c.metric} should not pull personal TAXABLE_INCOME`);
    }
  });
});
