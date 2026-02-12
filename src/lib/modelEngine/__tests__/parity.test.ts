import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compareModels, extractV1SpreadData } from "../parity/compareV1toV2";
import { formatParityReport } from "../parity/parityReport";
import { DEFAULT_THRESHOLDS, RELAXED_THRESHOLDS } from "../parity/thresholds";
import type { V1SpreadData, ParityThresholds } from "../parity/types";
import type { FinancialModel } from "../types";
import type { RenderedSpread } from "@/lib/financialSpreads/types";
import {
  CLEAN_FYE,
  TWO_FYE,
  FYE_WITH_INTERIM,
  V2_EXTRA_PERIOD,
  SCALING_ERROR,
  ALL_GOLDEN_FIXTURES,
} from "./fixtures/goldenDeals";

// ===================================================================
// Golden fixture tests
// ===================================================================

describe("parity: golden fixtures", () => {
  it("CLEAN_FYE: single period exact match → PASS", () => {
    const result = compareModels(
      CLEAN_FYE.dealId,
      CLEAN_FYE.v1Spreads,
      CLEAN_FYE.v2Model,
    );

    assert.equal(result.passFail, "PASS");
    assert.equal(result.periods.length, CLEAN_FYE.expected.periodCount);
    assert.equal(result.periods[0].aligned, true);
    assert.equal(result.periods[0].source, "both");

    // All headlines should pass
    for (const h of result.headline) {
      assert.equal(h.withinTolerance, true, `${h.metric} should be within tolerance`);
    }

    // No mismatches
    const mismatches = result.diffs.filter((d) => d.status === "mismatch");
    assert.equal(mismatches.length, 0);

    // No error flags
    const errors = result.flags.filter((f) => f.severity === "error");
    assert.equal(errors.length, 0);
  });

  it("TWO_FYE: multi-year exact match → PASS", () => {
    const result = compareModels(
      TWO_FYE.dealId,
      TWO_FYE.v1Spreads,
      TWO_FYE.v2Model,
    );

    assert.equal(result.passFail, "PASS");
    assert.equal(result.periods.length, 2);
    assert.equal(result.periods[0].periodEnd, "2023-12-31");
    assert.equal(result.periods[1].periodEnd, "2024-12-31");
    assert.ok(result.periods.every((p) => p.aligned));
  });

  it("FYE_WITH_INTERIM: fiscal year + mid-year → PASS", () => {
    const result = compareModels(
      FYE_WITH_INTERIM.dealId,
      FYE_WITH_INTERIM.v1Spreads,
      FYE_WITH_INTERIM.v2Model,
    );

    assert.equal(result.passFail, "PASS");
    assert.equal(result.periods.length, 2);

    // Headline revenue should match for both periods
    const revHeadlines = result.headline.filter((h) => h.metric === "revenue");
    assert.equal(revHeadlines.length, 2);
    for (const h of revHeadlines) {
      assert.equal(h.withinTolerance, true, `revenue@${h.periodEnd} should match`);
    }
  });

  it("V2_EXTRA_PERIOD: V2 has extra period → PASS (warning, not error)", () => {
    const result = compareModels(
      V2_EXTRA_PERIOD.dealId,
      V2_EXTRA_PERIOD.v1Spreads,
      V2_EXTRA_PERIOD.v2Model,
    );

    assert.equal(result.passFail, "PASS");
    assert.equal(result.periods.length, 2);

    // One period is "both", one is "v2_only"
    const both = result.periods.filter((p) => p.source === "both");
    const v2Only = result.periods.filter((p) => p.source === "v2_only");
    assert.equal(both.length, 1);
    assert.equal(v2Only.length, 1);

    // v2_only should generate a warning flag, not error
    const warningFlags = result.flags.filter(
      (f) => f.type === "missing_period" && f.severity === "warning",
    );
    assert.equal(warningFlags.length, 1);

    // No error flags
    const errors = result.flags.filter((f) => f.severity === "error");
    assert.equal(errors.length, 0);
  });

  it("SCALING_ERROR: V1 in thousands vs V2 in units → FAIL", () => {
    const result = compareModels(
      SCALING_ERROR.dealId,
      SCALING_ERROR.v1Spreads,
      SCALING_ERROR.v2Model,
    );

    assert.equal(result.passFail, "FAIL");

    // Should have mismatches
    const mismatches = result.diffs.filter((d) => d.status === "mismatch");
    assert.ok(mismatches.length >= 3, `Expected >=3 mismatches, got ${mismatches.length}`);

    // Should detect scaling errors
    const scalingFlags = result.flags.filter((f) => f.type === "scaling_error");
    assert.ok(scalingFlags.length >= 1, `Expected scaling_error flags, got ${scalingFlags.length}`);
  });

  it("all golden fixtures produce expected verdict", () => {
    for (const fixture of ALL_GOLDEN_FIXTURES) {
      const result = compareModels(
        fixture.dealId,
        fixture.v1Spreads,
        fixture.v2Model,
      );
      assert.equal(
        result.passFail,
        fixture.expected.passFail,
        `${fixture.name}: expected ${fixture.expected.passFail}, got ${result.passFail}`,
      );
    }
  });
});

// ===================================================================
// compareModels unit tests
// ===================================================================

describe("parity: compareModels", () => {
  it("returns PASS for empty V1 and empty V2", () => {
    const result = compareModels("empty-deal", [], { dealId: "empty-deal", periods: [] });
    assert.equal(result.passFail, "PASS");
    assert.equal(result.periods.length, 0);
    assert.equal(result.diffs.length, 0);
    assert.equal(result.headline.length, 0);
  });

  it("returns FAIL when V1 has a period V2 lacks (missing_period error)", () => {
    const v1: V1SpreadData[] = [
      {
        spreadType: "BALANCE_SHEET",
        periods: [{ key: "2024-12-31", label: "Dec 2024", endDate: "2024-12-31", isAggregate: false }],
        rows: [{ key: "TOTAL_ASSETS", label: "Total Assets", section: "TOTAL", valueByPeriod: { "2024-12-31": 1000000 } }],
      },
    ];
    const v2: FinancialModel = { dealId: "test", periods: [] };

    const result = compareModels("test", v1, v2);
    assert.equal(result.passFail, "FAIL");
    assert.ok(result.flags.some((f) => f.type === "missing_period" && f.severity === "error"));
  });

  it("detects sign flip", () => {
    const v1: V1SpreadData[] = [
      {
        spreadType: "BALANCE_SHEET",
        periods: [{ key: "2024-12-31", label: "Dec 2024", endDate: "2024-12-31", isAggregate: false }],
        rows: [{ key: "TOTAL_ASSETS", label: "Total Assets", section: "TOTAL", valueByPeriod: { "2024-12-31": 1000000 } }],
      },
    ];
    const v2: FinancialModel = {
      dealId: "test",
      periods: [{
        periodId: "test:2024-12-31", periodEnd: "2024-12-31", type: "FYE",
        income: {}, balance: { totalAssets: -1000000 }, cashflow: {},
        qualityFlags: [],
      }],
    };

    const result = compareModels("test", v1, v2);
    assert.ok(result.flags.some((f) => f.type === "sign_flip"));
  });

  it("detects zero-filled rows", () => {
    const v1: V1SpreadData[] = [
      {
        spreadType: "BALANCE_SHEET",
        periods: [{ key: "2024-12-31", label: "Dec 2024", endDate: "2024-12-31", isAggregate: false }],
        rows: [{ key: "TOTAL_ASSETS", label: "Total Assets", section: "TOTAL", valueByPeriod: { "2024-12-31": 0 } }],
      },
    ];
    const v2: FinancialModel = {
      dealId: "test",
      periods: [{
        periodId: "test:2024-12-31", periodEnd: "2024-12-31", type: "FYE",
        income: {}, balance: { totalAssets: 500000 }, cashflow: {},
        qualityFlags: [],
      }],
    };

    const result = compareModels("test", v1, v2);
    assert.ok(result.flags.some((f) => f.type === "zero_filled"));
  });

  it("skips aggregate V1 columns (TTM, YTD)", () => {
    const v1: V1SpreadData[] = [
      {
        spreadType: "T12",
        periods: [
          { key: "2024-12-31", label: "Dec 2024", endDate: "2024-12-31", isAggregate: false },
          { key: "TTM", label: "TTM", endDate: "2024-12-31", isAggregate: true },
        ],
        rows: [
          {
            key: "TOTAL_INCOME", label: "Total Income", section: "INCOME",
            valueByPeriod: { "2024-12-31": 100000, "TTM": 1200000 },
          },
        ],
      },
    ];
    const v2: FinancialModel = {
      dealId: "test",
      periods: [{
        periodId: "test:2024-12-31", periodEnd: "2024-12-31", type: "FYE",
        income: { revenue: 100000 }, balance: {}, cashflow: { ebitda: 100000, cfads: 100000 },
        qualityFlags: [],
      }],
    };

    const result = compareModels("test", v1, v2);
    // Should align only the non-aggregate period
    assert.equal(result.periods.length, 1);
    assert.equal(result.periods[0].periodEnd, "2024-12-31");
    assert.equal(result.periods[0].aligned, true);
  });

  it("uses custom thresholds (relaxed tolerance)", () => {
    const v1: V1SpreadData[] = [
      {
        spreadType: "BALANCE_SHEET",
        periods: [{ key: "2024-12-31", label: "Dec 2024", endDate: "2024-12-31", isAggregate: false }],
        rows: [
          { key: "TOTAL_ASSETS", label: "Total Assets", section: "TOTAL", valueByPeriod: { "2024-12-31": 1000000 } },
          { key: "TOTAL_LIABILITIES", label: "Total Liabilities", section: "TOTAL", valueByPeriod: { "2024-12-31": 500000 } },
          { key: "TOTAL_EQUITY", label: "Total Equity", section: "EQUITY", valueByPeriod: { "2024-12-31": 500001 } },
        ],
      },
    ];
    const v2: FinancialModel = {
      dealId: "test",
      periods: [{
        periodId: "test:2024-12-31", periodEnd: "2024-12-31", type: "FYE",
        income: {}, balance: { totalAssets: 1000001, totalLiabilities: 500000, equity: 500001 }, cashflow: {},
        qualityFlags: [],
      }],
    };

    // Strict: $1 diff on totalAssets → FAIL
    const strict = compareModels("test", v1, v2, DEFAULT_THRESHOLDS);
    assert.equal(strict.passFail, "FAIL");

    // Relaxed: $1 tolerance → PASS
    const relaxed = compareModels("test", v1, v2, RELAXED_THRESHOLDS);
    assert.equal(relaxed.passFail, "PASS");
  });

  it("thresholdsUsed is recorded in result", () => {
    const result = compareModels("test", [], { dealId: "test", periods: [] }, RELAXED_THRESHOLDS);
    assert.equal(result.thresholdsUsed.lineItemTolerance, 1);
    assert.equal(result.thresholdsUsed.headlineAbsTolerance, 1);
  });
});

// ===================================================================
// extractV1SpreadData tests
// ===================================================================

describe("parity: extractV1SpreadData", () => {
  it("extracts from schema v3 spread (valueByCol)", () => {
    const spread: RenderedSpread = {
      schema_version: 3,
      title: "T12",
      spread_type: "T12",
      columns: ["Dec 2024"],
      columnsV2: [{ key: "2024-12-31", label: "Dec 2024", kind: "month", end_date: "2024-12-31" }],
      rows: [
        {
          key: "TOTAL_INCOME",
          label: "Total Income",
          section: "INCOME",
          values: [{
            value: 500000,
            valueByCol: { "2024-12-31": 500000 },
            displayByCol: { "2024-12-31": "$500,000" },
          }],
        },
      ],
    };

    const data = extractV1SpreadData(spread);
    assert.equal(data.spreadType, "T12");
    assert.equal(data.periods.length, 1);
    assert.equal(data.periods[0].endDate, "2024-12-31");
    assert.equal(data.rows[0].valueByPeriod["2024-12-31"], 500000);
  });

  it("extracts from schema v1 spread (positional)", () => {
    const spread: RenderedSpread = {
      title: "Balance Sheet",
      spread_type: "BALANCE_SHEET",
      columns: ["Dec 2024"],
      rows: [
        {
          key: "TOTAL_ASSETS",
          label: "Total Assets",
          values: [2000000],
        },
      ],
    };

    const data = extractV1SpreadData(spread);
    assert.equal(data.spreadType, "BALANCE_SHEET");
    assert.equal(data.rows[0].valueByPeriod["Dec 2024"], 2000000);
  });

  it("marks TTM columns as aggregate", () => {
    const spread: RenderedSpread = {
      schema_version: 3,
      title: "T12",
      spread_type: "T12",
      columns: ["Dec 2024", "TTM"],
      columnsV2: [
        { key: "2024-12-31", label: "Dec 2024", kind: "month", end_date: "2024-12-31" },
        { key: "TTM", label: "TTM", kind: "ttm", end_date: "2024-12-31" },
      ],
      rows: [],
    };

    const data = extractV1SpreadData(spread);
    assert.equal(data.periods[0].isAggregate, false);
    assert.equal(data.periods[1].isAggregate, true);
  });

  it("skips section_header rows", () => {
    const spread: RenderedSpread = {
      title: "BS",
      spread_type: "BALANCE_SHEET",
      columns: ["Dec 2024"],
      rows: [
        { key: "_header_CURRENT_ASSETS", label: "Current Assets", values: [], notes: "section_header" },
        { key: "CASH_AND_EQUIVALENTS", label: "Cash", values: [50000] },
      ],
    };

    const data = extractV1SpreadData(spread);
    assert.equal(data.rows.length, 1);
    assert.equal(data.rows[0].key, "CASH_AND_EQUIVALENTS");
  });

  it("infers end date from column labels (Dec 2024 → 2024-12-31)", () => {
    const spread: RenderedSpread = {
      title: "BS",
      spread_type: "BALANCE_SHEET",
      columns: ["Dec 2024", "Jun 2025"],
      rows: [],
    };

    const data = extractV1SpreadData(spread);
    assert.equal(data.periods[0].endDate, "2024-12-31");
    assert.equal(data.periods[1].endDate, "2025-06-30");
  });
});

// ===================================================================
// formatParityReport tests
// ===================================================================

describe("parity: formatParityReport", () => {
  it("produces markdown for a passing comparison", () => {
    const result = compareModels(
      CLEAN_FYE.dealId,
      CLEAN_FYE.v1Spreads,
      CLEAN_FYE.v2Model,
    );
    const md = formatParityReport(result);

    assert.ok(md.includes("# Parity Report:"));
    assert.ok(md.includes("**Verdict: PASS**"));
    assert.ok(md.includes("## Period Alignment"));
    assert.ok(md.includes("## Headline Metrics"));
    assert.ok(md.includes("## Thresholds Used"));
    assert.ok(md.includes("## Summary"));
  });

  it("produces markdown for a failing comparison with mismatches", () => {
    const result = compareModels(
      SCALING_ERROR.dealId,
      SCALING_ERROR.v1Spreads,
      SCALING_ERROR.v2Model,
    );
    const md = formatParityReport(result);

    assert.ok(md.includes("**Verdict: FAIL**"));
    assert.ok(md.includes("## Line Item Mismatches"));
    assert.ok(md.includes("## Flags"));
    assert.ok(md.includes("scaling_error"));
  });

  it("includes summary stats", () => {
    const result = compareModels("test", [], { dealId: "test", periods: [] });
    const md = formatParityReport(result);
    assert.ok(md.includes("Total comparisons: 0"));
    assert.ok(md.includes("Matches: 0"));
  });
});
