/**
 * SPEC-FINENGINE-FULL-SPREAD-1 — Phase 4: structural & temporal analysis.
 *
 * Common-size (vertical) statements, horizontal (period-over-period) change,
 * multi-period trend, year-over-year growth, CAGR, and a peer-benchmark hook.
 * These are the "shape of the statement / shape of the trajectory" diagnostics
 * that turn a single-period spread into a story. Pure — no DB, no thresholds
 * (interpretation lives in metrics/interpret.ts).
 */

import type { MetricResult } from "@/lib/finengine/contracts";
import { div } from "@/lib/finengine/metrics/helpers";

const z = (v: number | null | undefined): number => (v == null ? 0 : v);

/** A MetricResult that also carries a per-line breakdown and/or a period series. */
export type StructuralResult = MetricResult & {
  components?: Record<string, number | null>;
  series?: Array<{ period: string; value: number | null }>;
};

function base(metric: string, value: number | null, inputs: Record<string, number>, explanation: string): MetricResult {
  return { metric, value, inputs, explanation };
}

// ---------------------------------------------------------------------------
// Common-size (vertical) analysis — every line as a fraction of a base
// ---------------------------------------------------------------------------

function commonSize(metric: string, lineItems: Record<string, number | null>, baseValue: number | null, baseLabel: string, explanation: string): StructuralResult {
  const denom = baseValue == null || baseValue === 0 ? null : baseValue;
  const components: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(lineItems)) components[k] = div(v, denom);
  return { ...base(metric, baseValue, { [baseLabel]: z(baseValue) }, explanation), components };
}

/** Common-size balance sheet — each line ÷ total assets. */
export function commonSizeBalanceSheet(lineItems: Record<string, number | null>, totalAssets: number | null): StructuralResult {
  return commonSize("COMMON_SIZE_BALANCE_SHEET", lineItems, totalAssets, "totalAssets",
    "Common-size balance sheet — each line as a fraction of total assets (capital structure & asset mix at a glance).");
}

/** Common-size income statement — each line ÷ revenue. */
export function commonSizeIncome(lineItems: Record<string, number | null>, revenue: number | null): StructuralResult {
  return commonSize("COMMON_SIZE_INCOME", lineItems, revenue, "revenue",
    "Common-size income statement — each line as a fraction of revenue (cost structure & margin waterfall).");
}

// ---------------------------------------------------------------------------
// Horizontal (period-over-period) analysis
// ---------------------------------------------------------------------------

/** Dollar + percent change of one line between two periods. value = percent change. */
export function horizontalAnalysis(current: number | null, prior: number | null): StructuralResult {
  const dollarChange = current == null && prior == null ? null : z(current) - z(prior);
  const pctChange = prior == null || prior === 0 ? null : (z(current) - z(prior)) / Math.abs(prior);
  return {
    ...base("HORIZONTAL_ANALYSIS", pctChange, { current: z(current), prior: z(prior), dollarChange: z(dollarChange) },
      "Horizontal analysis — (current − prior) ÷ |prior|; the dollar change rides in inputs."),
    components: { dollarChange, pctChange },
  };
}

// ---------------------------------------------------------------------------
// Trend — multi-period trajectory
// ---------------------------------------------------------------------------

/**
 * Trend over an ordered period series. value = total change (last vs first) ÷ |first|.
 * Components expose the step-direction tally so a reader can see monotonicity vs noise.
 */
export function trend(series: Array<{ period: string; value: number | null }>): StructuralResult {
  const points = series.filter((p) => p.value != null) as Array<{ period: string; value: number }>;
  let value: number | null = null;
  let up = 0, down = 0, flat = 0;
  if (points.length >= 2) {
    const first = points[0].value;
    const last = points[points.length - 1].value;
    value = first === 0 ? null : (last - first) / Math.abs(first);
    for (let i = 1; i < points.length; i++) {
      const d = points[i].value - points[i - 1].value;
      if (d > 0) up++; else if (d < 0) down++; else flat++;
    }
  }
  return {
    ...base("TREND", value, { points: points.length, up, down, flat },
      "Trend — total change from first to last period ÷ |first|; step tally (up/down/flat) flags monotonic vs erratic trajectories."),
    series,
    components: { stepsUp: up, stepsDown: down, stepsFlat: flat },
  };
}

// ---------------------------------------------------------------------------
// Growth — YoY and CAGR
// ---------------------------------------------------------------------------

/** Year-over-year growth = (current − prior) ÷ |prior|. */
export function growthYoY(current: number | null, prior: number | null): StructuralResult {
  const value = prior == null || prior === 0 ? null : (z(current) - z(prior)) / Math.abs(prior);
  return base("GROWTH_YOY", value, { current: z(current), prior: z(prior) },
    "Year-over-year growth = (current − prior) ÷ |prior|.");
}

/** Compound annual growth rate = (end ÷ begin)^(1/periods) − 1; null if signs/zeros make it undefined. */
export function cagr(beginValue: number | null, endValue: number | null, periods: number | null): StructuralResult {
  let value: number | null = null;
  if (beginValue != null && endValue != null && periods != null && periods > 0 && beginValue > 0 && endValue > 0) {
    value = Math.pow(endValue / beginValue, 1 / periods) - 1;
  }
  return base("CAGR", value, { beginValue: z(beginValue), endValue: z(endValue), periods: z(periods) },
    "CAGR = (end ÷ begin)^(1/periods) − 1 — smoothed annual growth. Undefined for non-positive endpoints.");
}

// ---------------------------------------------------------------------------
// Peer benchmark hook
// ---------------------------------------------------------------------------

/**
 * Peer benchmark — the subject value relative to a peer median (value = ratio).
 * An optional percentile (0..1) rides in components when the caller supplies a
 * peer distribution rank. Pure: the caller owns the peer data source.
 */
export function peerBenchmark(metricValue: number | null, peerMedian: number | null, opts?: { percentile?: number | null }): StructuralResult {
  const relative = div(metricValue, peerMedian);
  return {
    ...base("PEER_BENCHMARK", relative, { metricValue: z(metricValue), peerMedian: z(peerMedian) },
      "Peer benchmark = subject value ÷ peer median (1.0 = at peer median). Percentile rank in components when provided."),
    components: { relative, percentile: opts?.percentile ?? null },
  };
}
