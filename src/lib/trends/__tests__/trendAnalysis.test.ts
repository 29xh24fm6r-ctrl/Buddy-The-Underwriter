import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyzeTrends, type TrendPeriodInput } from "../trendAnalysis";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePeriod(
  year: number,
  overrides: Partial<Omit<TrendPeriodInput, "year">> = {},
): TrendPeriodInput {
  return {
    year,
    revenue: null,
    ebitda: null,
    grossMarginPct: null,
    dso: null,
    dio: null,
    debtToEbitda: null,
    dscr: null,
    netWorth: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Revenue Trend
// ---------------------------------------------------------------------------

describe("Trend Analysis — Revenue", () => {
  it("detects positive revenue trend", () => {
    const result = analyzeTrends([
      makePeriod(2021, { revenue: 1_000_000 }),
      makePeriod(2022, { revenue: 1_100_000 }),
      makePeriod(2023, { revenue: 1_250_000 }),
    ]);
    assert.equal(result.trendRevenue.direction, "POSITIVE");
    assert.equal(result.trendRevenue.riskSignal, null);
  });

  it("detects declining revenue with risk signal", () => {
    const result = analyzeTrends([
      makePeriod(2021, { revenue: 1_200_000 }),
      makePeriod(2022, { revenue: 1_100_000 }),
      makePeriod(2023, { revenue: 1_000_000 }),
    ]);
    assert.equal(result.trendRevenue.direction, "DECLINING");
    assert.ok(result.trendRevenue.riskSignal?.includes("material risk"));
  });

  it("detects neutral revenue (mixed changes)", () => {
    const result = analyzeTrends([
      makePeriod(2021, { revenue: 1_000_000 }),
      makePeriod(2022, { revenue: 1_100_000 }),
      makePeriod(2023, { revenue: 1_050_000 }),
    ]);
    assert.equal(result.trendRevenue.direction, "NEUTRAL");
  });

  it("returns null direction for single period", () => {
    const result = analyzeTrends([
      makePeriod(2023, { revenue: 1_000_000 }),
    ]);
    assert.equal(result.trendRevenue.direction, null);
  });

  it("handles 2-period positive trend", () => {
    const result = analyzeTrends([
      makePeriod(2022, { revenue: 900_000 }),
      makePeriod(2023, { revenue: 1_000_000 }),
    ]);
    assert.equal(result.trendRevenue.direction, "POSITIVE");
  });
});

// ---------------------------------------------------------------------------
// EBITDA Trend
// ---------------------------------------------------------------------------

describe("Trend Analysis — EBITDA", () => {
  it("detects positive EBITDA trend", () => {
    const result = analyzeTrends([
      makePeriod(2021, { ebitda: 200_000 }),
      makePeriod(2022, { ebitda: 250_000 }),
      makePeriod(2023, { ebitda: 300_000 }),
    ]);
    assert.equal(result.trendEbitda.direction, "POSITIVE");
  });

  it("detects declining EBITDA trend", () => {
    const result = analyzeTrends([
      makePeriod(2021, { ebitda: 300_000 }),
      makePeriod(2022, { ebitda: 250_000 }),
      makePeriod(2023, { ebitda: 200_000 }),
    ]);
    assert.equal(result.trendEbitda.direction, "DECLINING");
  });
});

// ---------------------------------------------------------------------------
// Gross Margin Trend
// ---------------------------------------------------------------------------

describe("Trend Analysis — Gross Margin", () => {
  it("detects expanding margin", () => {
    const result = analyzeTrends([
      makePeriod(2021, { grossMarginPct: 30 }),
      makePeriod(2022, { grossMarginPct: 33 }),
      makePeriod(2023, { grossMarginPct: 36 }),
    ]);
    assert.equal(result.trendGrossMargin.direction, "EXPANDING");
  });

  it("detects compressing margin with risk signal", () => {
    const result = analyzeTrends([
      makePeriod(2021, { grossMarginPct: 40 }),
      makePeriod(2022, { grossMarginPct: 36 }),
      makePeriod(2023, { grossMarginPct: 32 }),
    ]);
    assert.equal(result.trendGrossMargin.direction, "COMPRESSING");
    assert.ok(result.trendGrossMargin.riskSignal?.includes("compression"));
  });

  it("detects stable margin (changes < 1pp)", () => {
    const result = analyzeTrends([
      makePeriod(2021, { grossMarginPct: 35.0 }),
      makePeriod(2022, { grossMarginPct: 35.5 }),
      makePeriod(2023, { grossMarginPct: 35.8 }),
    ]);
    assert.equal(result.trendGrossMargin.direction, "STABLE");
  });
});

// ---------------------------------------------------------------------------
// DSO Trend
// ---------------------------------------------------------------------------

describe("Trend Analysis — DSO", () => {
  it("detects improving DSO (decreasing)", () => {
    const result = analyzeTrends([
      makePeriod(2021, { dso: 65 }),
      makePeriod(2022, { dso: 55 }),
      makePeriod(2023, { dso: 45 }),
    ]);
    assert.equal(result.trendDso.direction, "IMPROVING");
    assert.equal(result.trendDso.riskSignal, null);
  });

  it("detects deteriorating DSO with risk signal", () => {
    const result = analyzeTrends([
      makePeriod(2021, { dso: 45 }),
      makePeriod(2022, { dso: 60 }),
      makePeriod(2023, { dso: 75 }),
    ]);
    assert.equal(result.trendDso.direction, "DETERIORATING");
    assert.ok(result.trendDso.riskSignal?.includes("collection"));
  });
});

// ---------------------------------------------------------------------------
// DIO Trend
// ---------------------------------------------------------------------------

describe("Trend Analysis — DIO", () => {
  it("detects deteriorating DIO with risk signal", () => {
    const result = analyzeTrends([
      makePeriod(2021, { dio: 30 }),
      makePeriod(2022, { dio: 45 }),
      makePeriod(2023, { dio: 60 }),
    ]);
    assert.equal(result.trendDio.direction, "DETERIORATING");
    assert.ok(result.trendDio.riskSignal?.includes("inventory"));
  });

  it("detects improving DIO", () => {
    const result = analyzeTrends([
      makePeriod(2021, { dio: 60 }),
      makePeriod(2022, { dio: 50 }),
      makePeriod(2023, { dio: 40 }),
    ]);
    assert.equal(result.trendDio.direction, "IMPROVING");
  });
});

// ---------------------------------------------------------------------------
// Leverage Trend
// ---------------------------------------------------------------------------

describe("Trend Analysis — Leverage", () => {
  it("detects improving leverage (decreasing Debt/EBITDA)", () => {
    const result = analyzeTrends([
      makePeriod(2021, { debtToEbitda: 4.5 }),
      makePeriod(2022, { debtToEbitda: 3.5 }),
      makePeriod(2023, { debtToEbitda: 2.8 }),
    ]);
    assert.equal(result.trendLeverage.direction, "IMPROVING");
  });

  it("detects worsening leverage with risk signal", () => {
    const result = analyzeTrends([
      makePeriod(2021, { debtToEbitda: 2.0 }),
      makePeriod(2022, { debtToEbitda: 3.0 }),
      makePeriod(2023, { debtToEbitda: 4.5 }),
    ]);
    assert.equal(result.trendLeverage.direction, "WORSENING");
    assert.ok(result.trendLeverage.riskSignal?.includes("deterioration"));
  });
});

// ---------------------------------------------------------------------------
// DSCR Trend
// ---------------------------------------------------------------------------

describe("Trend Analysis — DSCR", () => {
  it("detects improving DSCR", () => {
    const result = analyzeTrends([
      makePeriod(2021, { dscr: 1.10 }),
      makePeriod(2022, { dscr: 1.25 }),
      makePeriod(2023, { dscr: 1.40 }),
    ]);
    assert.equal(result.trendDscr.direction, "POSITIVE");
  });

  it("detects declining DSCR", () => {
    const result = analyzeTrends([
      makePeriod(2021, { dscr: 1.50 }),
      makePeriod(2022, { dscr: 1.30 }),
      makePeriod(2023, { dscr: 1.10 }),
    ]);
    assert.equal(result.trendDscr.direction, "DECLINING");
  });
});

// ---------------------------------------------------------------------------
// Net Worth Trend
// ---------------------------------------------------------------------------

describe("Trend Analysis — Net Worth", () => {
  it("detects growing net worth", () => {
    const result = analyzeTrends([
      makePeriod(2021, { netWorth: 500_000 }),
      makePeriod(2022, { netWorth: 600_000 }),
      makePeriod(2023, { netWorth: 750_000 }),
    ]);
    assert.equal(result.trendNetWorth.direction, "GROWING");
    assert.equal(result.trendNetWorth.riskSignal, null);
  });

  it("detects eroding net worth with risk signal", () => {
    const result = analyzeTrends([
      makePeriod(2021, { netWorth: 750_000 }),
      makePeriod(2022, { netWorth: 600_000 }),
      makePeriod(2023, { netWorth: 500_000 }),
    ]);
    assert.equal(result.trendNetWorth.direction, "ERODING");
    assert.ok(result.trendNetWorth.riskSignal?.includes("erosion"));
  });
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe("Trend Analysis — Edge Cases", () => {
  it("returns all null directions for empty input", () => {
    const result = analyzeTrends([]);
    assert.equal(result.trendRevenue.direction, null);
    assert.equal(result.trendEbitda.direction, null);
    assert.equal(result.trendGrossMargin.direction, null);
    assert.equal(result.trendDso.direction, null);
    assert.equal(result.trendDio.direction, null);
    assert.equal(result.trendLeverage.direction, null);
    assert.equal(result.trendDscr.direction, null);
    assert.equal(result.trendNetWorth.direction, null);
  });

  it("sorts periods by year automatically", () => {
    const result = analyzeTrends([
      makePeriod(2023, { revenue: 1_200_000 }),
      makePeriod(2021, { revenue: 1_000_000 }),
      makePeriod(2022, { revenue: 1_100_000 }),
    ]);
    assert.equal(result.trendRevenue.direction, "POSITIVE");
    assert.deepEqual(result.trendRevenue.values, [1_000_000, 1_100_000, 1_200_000]);
  });

  it("handles null values in middle period", () => {
    const result = analyzeTrends([
      makePeriod(2021, { revenue: 1_000_000 }),
      makePeriod(2022, { revenue: null }),
      makePeriod(2023, { revenue: 1_200_000 }),
    ]);
    // Only one valid change pair (null gaps skipped) — can't determine
    assert.equal(result.trendRevenue.direction, null);
  });

  it("handles all null metric values", () => {
    const result = analyzeTrends([
      makePeriod(2021),
      makePeriod(2022),
      makePeriod(2023),
    ]);
    assert.equal(result.trendRevenue.direction, null);
  });

  it("no risk signal for 2-period declining revenue", () => {
    // Spec says "Declining 2+ years" = material risk
    // With only 2 periods, there's only 1 YoY change, not "2+ years declining"
    const result = analyzeTrends([
      makePeriod(2022, { revenue: 1_100_000 }),
      makePeriod(2023, { revenue: 1_000_000 }),
    ]);
    assert.equal(result.trendRevenue.direction, "DECLINING");
    // Only 1 change — not enough for "2+ years declining" risk signal
    assert.equal(result.trendRevenue.riskSignal, null);
  });
});
