import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { flagFromTrends } from "../flagFromTrends";
import type { FlagEngineInput } from "../types";
import type { TrendAnalysisResult } from "../../trends/trendAnalysis";
import { resetFlagCounter } from "../flagHelpers";

function neutralTrend() {
  return { direction: null, values: [], riskSignal: null };
}

function makeTrend(overrides: Partial<TrendAnalysisResult> = {}): TrendAnalysisResult {
  return {
    trendRevenue: neutralTrend() as TrendAnalysisResult["trendRevenue"],
    trendEbitda: neutralTrend() as TrendAnalysisResult["trendEbitda"],
    trendGrossMargin: neutralTrend() as TrendAnalysisResult["trendGrossMargin"],
    trendDso: neutralTrend() as TrendAnalysisResult["trendDso"],
    trendDio: neutralTrend() as TrendAnalysisResult["trendDio"],
    trendLeverage: neutralTrend() as TrendAnalysisResult["trendLeverage"],
    trendDscr: neutralTrend() as TrendAnalysisResult["trendDscr"],
    trendNetWorth: neutralTrend() as TrendAnalysisResult["trendNetWorth"],
    ...overrides,
  };
}

function makeInput(
  trend?: TrendAnalysisResult,
  facts: Record<string, unknown> = {},
): FlagEngineInput {
  resetFlagCounter();
  return {
    deal_id: "deal-1",
    canonical_facts: facts,
    ratios: {},
    years_available: [2021, 2022, 2023],
    trend_report: trend,
  };
}

describe("flagFromTrends", () => {
  // ── No trend report ────────────────────────────────────────────────────
  it("returns empty array when no trend_report provided", () => {
    const flags = flagFromTrends(makeInput());
    assert.equal(flags.length, 0);
  });

  // ── EBITDA declining ───────────────────────────────────────────────────
  it("flags ebitda_margin_declining_2yr when EBITDA is DECLINING", () => {
    const flags = flagFromTrends(makeInput(makeTrend({
      trendEbitda: {
        direction: "DECLINING",
        values: [500_000, 400_000, 300_000],
        riskSignal: "material risk",
      },
    })));
    const f = flags.find((f) => f.trigger_type === "ebitda_margin_declining_2yr");
    assert.ok(f);
    assert.equal(f.severity, "elevated");
  });

  it("does NOT flag EBITDA when direction is POSITIVE", () => {
    const flags = flagFromTrends(makeInput(makeTrend({
      trendEbitda: {
        direction: "POSITIVE",
        values: [300_000, 400_000, 500_000],
        riskSignal: null,
      },
    })));
    assert.ok(!flags.some((f) => f.trigger_type === "ebitda_margin_declining_2yr"));
  });

  // ── Revenue declining ──────────────────────────────────────────────────
  it("flags revenue_declining_2yr when revenue is DECLINING", () => {
    const flags = flagFromTrends(makeInput(makeTrend({
      trendRevenue: {
        direction: "DECLINING",
        values: [1_000_000, 800_000, 700_000],
        riskSignal: null,
      },
    })));
    const f = flags.find((f) => f.trigger_type === "revenue_declining_2yr");
    assert.ok(f);
    assert.equal(f.severity, "elevated");
  });

  // ── Revenue growing + margin compressing ───────────────────────────────
  it("flags revenue_growing_margin_compressing when revenue POSITIVE and margin COMPRESSING", () => {
    const flags = flagFromTrends(makeInput(makeTrend({
      trendRevenue: {
        direction: "POSITIVE",
        values: [800_000, 900_000, 1_000_000],
        riskSignal: null,
      },
      trendGrossMargin: {
        direction: "COMPRESSING",
        values: [0.45, 0.40, 0.35],
        riskSignal: null,
      },
    })));
    const f = flags.find((f) => f.trigger_type === "revenue_growing_margin_compressing");
    assert.ok(f);
    assert.equal(f.severity, "watch");
  });

  it("does NOT flag margin compression when revenue is not POSITIVE", () => {
    const flags = flagFromTrends(makeInput(makeTrend({
      trendRevenue: {
        direction: "DECLINING",
        values: [1_000_000, 900_000, 800_000],
        riskSignal: null,
      },
      trendGrossMargin: {
        direction: "COMPRESSING",
        values: [0.45, 0.40, 0.35],
        riskSignal: null,
      },
    })));
    assert.ok(!flags.some((f) => f.trigger_type === "revenue_growing_margin_compressing"));
  });

  // ── Leverage increasing ────────────────────────────────────────────────
  it("flags leverage_increasing_2yr when leverage is WORSENING", () => {
    const flags = flagFromTrends(makeInput(makeTrend({
      trendLeverage: {
        direction: "WORSENING",
        values: [3.0, 4.0, 5.0],
        riskSignal: null,
      },
    })));
    const f = flags.find((f) => f.trigger_type === "leverage_increasing_2yr");
    assert.ok(f);
    assert.equal(f.severity, "watch");
  });

  // ── Working capital deteriorating ──────────────────────────────────────
  it("flags working_capital_deteriorating when current/prior WC declines", () => {
    const flags = flagFromTrends(makeInput(makeTrend(), {
      TOTAL_CURRENT_ASSETS: 500_000,
      TOTAL_CURRENT_LIABILITIES: 400_000,
      TOTAL_CURRENT_ASSETS_PRIOR: 600_000,
      TOTAL_CURRENT_LIABILITIES_PRIOR: 300_000,
    }));
    // current WC = 100k, prior WC = 300k → decline
    const f = flags.find((f) => f.trigger_type === "working_capital_deteriorating");
    assert.ok(f);
  });

  // ── DSO increasing >= 15 days ──────────────────────────────────────────
  it("flags dso_increasing_15_days when DSO trend is DETERIORATING and increase >= 15", () => {
    const flags = flagFromTrends(makeInput(makeTrend({
      trendDso: {
        direction: "DETERIORATING",
        values: [45, 55, 65],
        riskSignal: null,
      },
    })));
    const f = flags.find((f) => f.trigger_type === "dso_increasing_15_days");
    assert.ok(f);
    assert.ok(f.banker_summary.includes("20 days"));
  });

  it("does NOT flag DSO when increase < 15 days even if DETERIORATING", () => {
    const flags = flagFromTrends(makeInput(makeTrend({
      trendDso: {
        direction: "DETERIORATING",
        values: [45, 50, 55],
        riskSignal: null,
      },
    })));
    assert.ok(!flags.some((f) => f.trigger_type === "dso_increasing_15_days"));
  });

  // ── All neutral ────────────────────────────────────────────────────────
  it("returns empty when all trends are neutral", () => {
    const flags = flagFromTrends(makeInput(makeTrend()));
    assert.equal(flags.length, 0);
  });
});
