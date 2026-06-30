/**
 * SPEC-FINENGINE-BALANCE-SHEET-PANEL-1 — allowlist firewall + projection tests.
 *
 * The load-bearing test is the one-engine wall: the panel allowlist ∩ the legacy-
 * displayed set = ∅. Plus: the allowlist is realizable from computeDealSpread, the
 * projector emits only allowlist metrics (server-side firewall), and the response is
 * dark unless source === finengine.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  BALANCE_SHEET_PANEL_METRICS,
  PANEL_METRIC_SET,
  LEGACY_DISPLAYED_METRICS,
  projectBalanceSheetPanel,
  buildFinengineSpreadResponse,
} from "@/lib/finengine/spread/balanceSheetPanelMetrics";
import { computeDealSpread, type DealSpread, type MetricCell } from "@/lib/finengine/spread/dealSpread";
import type { CertifiedFactRow } from "@/lib/finengine/shadow/dealInputAdapter";

const GEM = "gemini_primary_v1";
const biz = (k: string, p: string, v: number): CertifiedFactRow => ({ fact_key: k, fact_period_end: p, fact_value_num: v, source_canonical_type: "BUSINESS_TAX_RETURN", owner_type: "DEAL", confidence: 0.8, extractor: GEM, is_superseded: false, created_at: "2026-06-01T00:00:00Z" });

// Full balance-sheet + income fixture (two periods → turnover/returns; funded debt → DEBT_TO_CAPITAL).
const ROWS: CertifiedFactRow[] = [
  biz("GROSS_RECEIPTS", "2023-12-31", 15088769), biz("GROSS_RECEIPTS", "2024-12-31", 28767069),
  biz("COST_OF_GOODS_SOLD", "2023-12-31", 13292890), biz("COST_OF_GOODS_SOLD", "2024-12-31", 25233470),
  biz("GROSS_PROFIT", "2023-12-31", 1472421), biz("GROSS_PROFIT", "2024-12-31", 3533599),
  biz("NET_INCOME", "2023-12-31", -457567), biz("NET_INCOME", "2024-12-31", 250000),
  biz("M1_TAXABLE_INCOME", "2023-12-31", -457567), biz("M1_TAXABLE_INCOME", "2024-12-31", 200925),
  biz("DEPRECIATION", "2023-12-31", 61656), biz("DEPRECIATION", "2024-12-31", 210207),
  biz("TOTAL_CURRENT_ASSETS", "2023-12-31", 2950000), biz("TOTAL_CURRENT_ASSETS", "2024-12-31", 6800000),
  biz("TOTAL_CURRENT_LIABILITIES", "2023-12-31", 1773043), biz("TOTAL_CURRENT_LIABILITIES", "2024-12-31", 1500000),
  biz("SL_INVENTORY", "2023-12-31", 120000), biz("SL_INVENTORY", "2024-12-31", 180000),
  biz("SL_ACCOUNTS_PAYABLE", "2023-12-31", 900000), biz("SL_ACCOUNTS_PAYABLE", "2024-12-31", 1100000),
  biz("SL_TOTAL_ASSETS", "2023-12-31", 3003718), biz("SL_TOTAL_ASSETS", "2024-12-31", 6800000),
  biz("SL_TOTAL_EQUITY", "2023-12-31", 1230675), biz("SL_TOTAL_EQUITY", "2024-12-31", 5000000),
  biz("SL_TOTAL_LIABILITIES", "2023-12-31", 1773043), biz("SL_TOTAL_LIABILITIES", "2024-12-31", 1800000),
  biz("SL_RETAINED_EARNINGS", "2023-12-31", 1230675), biz("SL_RETAINED_EARNINGS", "2024-12-31", 4512938),
  biz("SL_CASH", "2023-12-31", 142463), biz("SL_CASH", "2024-12-31", 401558),
  biz("SL_AR_GROSS", "2023-12-31", 2805001), biz("SL_AR_GROSS", "2024-12-31", 6398442),
  biz("SL_PPE_GROSS", "2023-12-31", 500000), biz("SL_PPE_GROSS", "2024-12-31", 600000),
  biz("SL_ACCUMULATED_DEPRECIATION", "2023-12-31", 100000), biz("SL_ACCUMULATED_DEPRECIATION", "2024-12-31", 200000),
  biz("SL_INTANGIBLES_GROSS", "2023-12-31", 50000), biz("SL_INTANGIBLES_GROSS", "2024-12-31", 50000),
  biz("SL_MORTGAGES_NOTES_BONDS", "2023-12-31", 400000), biz("SL_MORTGAGES_NOTES_BONDS", "2024-12-31", 600000),
];

const spread = computeDealSpread("deal-bsp", ROWS);

describe("[bsp] balance-sheet panel — one-engine firewall (allowlist ∩ legacy = ∅)", () => {
  it("[bsp-1 — LOAD-BEARING] no allowlist metric is on the legacy board / hard-excluded", () => {
    for (const m of PANEL_METRIC_SET) {
      assert.ok(!LEGACY_DISPLAYED_METRICS.has(m), `${m} is on the legacy board — must not be in the panel allowlist`);
      assert.ok(!m.endsWith("_MARGIN"), `${m} is a margin — excluded`);
    }
    // Spot-check the explicit hard exclusions.
    for (const banned of ["EBITDA", "DSCR", "CURRENT_RATIO", "DEBT_TO_EQUITY", "GROSS_MARGIN"]) {
      assert.ok(!PANEL_METRIC_SET.has(banned), `${banned} must be excluded`);
    }
  });

  it("[bsp-2] the allowlist is realizable — every group's metrics are emitted by computeDealSpread", () => {
    const emitted = new Set(spread.cells.filter((c) => c.scope === "BUSINESS").map((c) => c.metric));
    for (const m of PANEL_METRIC_SET) {
      assert.ok(emitted.has(m), `allowlist metric ${m} is not emitted by computeDealSpread (wrong name?)`);
    }
  });
});

describe("[bsp] balance-sheet panel — projection", () => {
  it("[bsp-3] projects only allowlist metrics, latest real period, with rating + interpretation", () => {
    const { period, groups } = projectBalanceSheetPanel(spread);
    assert.equal(period, "2024-12-31"); // latest real period
    assert.ok(groups.length > 0);
    for (const g of groups) {
      for (const cell of g.cells) {
        assert.ok(PANEL_METRIC_SET.has(cell.metric), `${cell.metric} outside allowlist`);
        assert.ok(!LEGACY_DISPLAYED_METRICS.has(cell.metric));
        assert.equal(typeof cell.rating, "string");
        assert.equal(typeof cell.interpretation, "string");
        assert.ok(cell.period !== "SERIES" && cell.period !== "1900-01-01");
      }
    }
    // Net-new presence proof: cash ratio + an Altman Z are surfaced.
    const allMetrics = groups.flatMap((g) => g.cells.map((c) => c.metric));
    assert.ok(allMetrics.includes("CASH_RATIO"));
    assert.ok(allMetrics.includes("ALTMAN_Z_PRIME"));
  });

  it("[bsp-4 — server firewall] a rogue non-allowlist cell (EBITDA/CURRENT_RATIO) is never projected", () => {
    const mkCell = (metric: string): MetricCell => ({
      family: "liquidity", metric, scope: "BUSINESS", period: "2024-12-31", value: 9.9,
      rating: "strong", interpretation: { metric, rating: "strong", meaning: "x" } as unknown as MetricCell["interpretation"],
      inputs: {}, sourceKeys: [],
    });
    const rogue: DealSpread = {
      dealId: "d", scopes: ["BUSINESS"], snapshots: [], warnings: [],
      cells: [mkCell("EBITDA"), mkCell("CURRENT_RATIO"), mkCell("DSCR"), mkCell("CASH_RATIO")],
    };
    const { groups } = projectBalanceSheetPanel(rogue);
    const metrics = groups.flatMap((g) => g.cells.map((c) => c.metric));
    assert.deepEqual(metrics, ["CASH_RATIO"]); // only the allowlist metric survives
  });
});

describe("[bsp] balance-sheet panel — response (dark by default)", () => {
  it("[bsp-5] legacy source → { enabled:false }, NO payload", () => {
    const res = buildFinengineSpreadResponse("legacy", spread);
    assert.equal(res.enabled, false);
    assert.ok(!("groups" in res));
  });

  it("[bsp-6] finengine source → enabled with allowlist-only groups; null spread → disabled", () => {
    const res = buildFinengineSpreadResponse("finengine", spread);
    assert.equal(res.enabled, true);
    if (res.enabled) {
      for (const g of res.groups) for (const c of g.cells) assert.ok(PANEL_METRIC_SET.has(c.metric));
    }
    assert.equal(buildFinengineSpreadResponse("finengine", null).enabled, false);
  });
});

describe("[bsp] balance-sheet panel — no cross-engine data flow (grep guard)", () => {
  it("[bsp-7] the Panel-F component reads the finengine hook only, never useSpreadOutput", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/(app)/deals/[dealId]/financials/FinengineBalanceSheetPanel.tsx"),
      "utf8",
    );
    // Strip comments so the doc-comment's prose ("never useSpreadOutput") doesn't trip the guard.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(/useFinengineSpread/.test(code), "Panel F must use the finengine hook");
    assert.ok(!/useSpreadOutput/.test(code), "Panel F must NOT read the legacy spread data (one-engine firewall)");
  });
});
