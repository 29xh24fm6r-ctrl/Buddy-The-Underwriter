/**
 * Ratio Scorecard Builder — Panel 3
 *
 * Builds the ratio scorecard with percentile comparisons and policy checks.
 * Pure function — no DB, no server imports.
 */

import type {
  SpreadOutputInput,
  RatioScorecardReport,
  RatioGroup,
  RatioScorecardItem,
  RatioAssessment,
} from "./types";
import type { ComposedNarratives } from "./narrativeComposer";
import { getSpreadTemplate } from "./spreadTemplateRegistry";
import {
  benchmarkRatio,
  type BenchmarkMetricId,
  BENCHMARK_METRIC_IDS,
} from "../benchmarks/industryBenchmarks";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function buildRatioScorecard(
  input: SpreadOutputInput,
  narratives: ComposedNarratives,
): RatioScorecardReport {
  const template = getSpreadTemplate(input.deal_type);
  const policy = input.bank_policy ?? {
    dscr_minimum: 1.25,
    fccr_minimum: 1.15,
    current_ratio_minimum: 1.10,
    ltv_maximum: 0.75,
    ltc_maximum: 0.80,
    debt_ebitda_maximum: 4.5,
    post_close_liquidity_pct: 0.10,
  };
  const overrides = template.policy_threshold_overrides;
  const naicsCode = String(input.canonical_facts["naics_code"] ?? "");
  const revenue = toNum(input.canonical_facts["TOTAL_REVENUE"])
    ?? toNum(input.canonical_facts["is_gross_revenue"])
    ?? toNum(input.canonical_facts["GROSS_RECEIPTS"])
    ?? 5_000_000; // default tier if no revenue

  const groups: RatioGroup[] = template.primary_ratio_groups.map((group) => {
    const ratios: RatioScorecardItem[] = [];
    const seen = new Set<string>();

    for (const key of group.ratio_keys) {
      const value = getNum(input.ratios, key);
      if (value === null) continue;

      // Deduplicate — pick first matching key from aliases
      const normalizedKey = normalizeKey(key);
      if (seen.has(normalizedKey)) continue;
      seen.add(normalizedKey);

      const benchmark = naicsCode
        ? tryBenchmark(value, normalizedKey, naicsCode, revenue)
        : null;

      const { policyMin, policyMax } = getPolicyThresholds(normalizedKey, policy, overrides);
      const passesPolicy = evaluatePolicy(value, normalizedKey, policyMin, policyMax);

      const assessment: RatioAssessment = benchmark?.assessment
        ?? (passesPolicy === true ? "adequate" : passesPolicy === false ? "concerning" : null);

      const trend = getTrend(input, normalizedKey);
      const narrative = narratives.ratio_narratives[normalizedKey]
        ?? benchmark?.narrative
        ?? buildDefaultNarrative(normalizedKey, value, assessment);

      ratios.push({
        label: RATIO_LABELS[normalizedKey] ?? humanize(normalizedKey),
        canonical_key: normalizedKey,
        value,
        formatted_value: formatRatioValue(normalizedKey, value),
        percentile: benchmark?.percentile ?? null,
        assessment,
        peer_median: benchmark?.peerMedian ?? null,
        policy_minimum: policyMin,
        policy_maximum: policyMax,
        passes_policy: passesPolicy,
        narrative,
        trend,
      });
    }

    return { group_name: group.group_name, ratios };
  });

  // Filter out empty groups
  const nonEmptyGroups = groups.filter((g) => g.ratios.length > 0);

  // Overall assessment = lowest individual assessment
  const allAssessments = nonEmptyGroups
    .flatMap((g) => g.ratios)
    .map((r) => r.assessment)
    .filter((a): a is NonNullable<RatioAssessment> => a !== null);

  const overallAssessment = computeOverallAssessment(allAssessments);

  return { groups: nonEmptyGroups, overall_assessment: overallAssessment };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const RATIO_LABELS: Record<string, string> = {
  DSCR: "Debt Service Coverage Ratio",
  FCCR: "Fixed Charge Coverage Ratio",
  CURRENT_RATIO: "Current Ratio",
  QUICK_RATIO: "Quick Ratio",
  DEBT_TO_EBITDA: "Debt / EBITDA",
  DEBT_TO_EQUITY: "Debt / Equity",
  DSO: "Days Sales Outstanding",
  DIO: "Days Inventory Outstanding",
  DPO: "Days Payable Outstanding",
  CCC: "Cash Conversion Cycle",
  GROSS_MARGIN: "Gross Profit Margin",
  EBITDA_MARGIN: "EBITDA Margin",
  NET_MARGIN: "Net Profit Margin",
  ROA: "Return on Assets",
  ROE: "Return on Equity",
  LTV: "Loan-to-Value",
  LTC: "Loan-to-Cost",
  INTEREST_COVERAGE: "Interest Coverage",
};

const DAYS_METRICS = new Set(["DSO", "DIO", "DPO", "CCC"]);
const PCT_METRICS = new Set(["GROSS_MARGIN", "EBITDA_MARGIN", "NET_MARGIN", "ROA", "ROE", "LTV", "LTC"]);
const RATIO_METRICS = new Set(["DSCR", "FCCR", "CURRENT_RATIO", "QUICK_RATIO", "DEBT_TO_EBITDA", "DEBT_TO_EQUITY", "INTEREST_COVERAGE"]);

export function formatRatioValue(key: string, value: number): string {
  if (DAYS_METRICS.has(key)) return `${Math.round(value)} days`;
  if (PCT_METRICS.has(key)) {
    // If value looks like a decimal (0-1), convert
    const pct = Math.abs(value) <= 1 ? value * 100 : value;
    return `${pct.toFixed(1)}%`;
  }
  if (RATIO_METRICS.has(key)) return `${value.toFixed(2)}x`;
  // Default: try to detect
  if (Math.abs(value) <= 100) return `${value.toFixed(2)}x`;
  return value.toLocaleString("en-US");
}

// ---------------------------------------------------------------------------
// Key normalization — map ratio_xxx to standard benchmark keys
// ---------------------------------------------------------------------------

const KEY_ALIASES: Record<string, string> = {
  ratio_dscr_final: "DSCR",
  ratio_fccr: "FCCR",
  ratio_debt_ebitda: "DEBT_TO_EBITDA",
  ratio_debt_equity: "DEBT_TO_EQUITY",
  ratio_dso: "DSO",
  ratio_dio: "DIO",
  ratio_dpo: "DPO",
  ratio_ccc: "CCC",
  ratio_current: "CURRENT_RATIO",
  ratio_quick: "QUICK_RATIO",
  ratio_gross_margin_pct: "GROSS_MARGIN",
  ratio_ebitda_margin_pct: "EBITDA_MARGIN",
  ratio_net_margin_pct: "NET_MARGIN",
  ratio_roa_pct: "ROA",
  ratio_roe_pct: "ROE",
  ratio_ltv: "LTV",
  ratio_noi_dscr: "DSCR",
  cre_dscr: "DSCR",
  cre_ltv_pct: "LTV",
  cre_ltc_pct: "LTC",
  cre_debt_yield_pct: "DEBT_YIELD",
  cre_cap_rate_pct: "CAP_RATE",
  cre_breakeven_occ_pct: "BREAKEVEN_OCC",
  cre_occupancy_pct: "OCCUPANCY",
  ratio_revenue_per_provider: "REVENUE_PER_PROVIDER",
  ratio_collections_ratio: "COLLECTIONS_RATIO",
  ratio_overhead_ratio: "OVERHEAD_RATIO",
};

function normalizeKey(key: string): string {
  return KEY_ALIASES[key] ?? key;
}

// ---------------------------------------------------------------------------
// Benchmark lookup
// ---------------------------------------------------------------------------

const BENCHMARK_KEY_MAP: Record<string, BenchmarkMetricId> = {
  DSCR: "DSCR",
  FCCR: "DSCR", // approximate
  CURRENT_RATIO: "CURRENT_RATIO",
  QUICK_RATIO: "QUICK_RATIO",
  DEBT_TO_EBITDA: "DEBT_TO_EBITDA",
  DEBT_TO_EQUITY: "DEBT_TO_EQUITY",
  DSO: "DSO",
  DIO: "DIO",
  DPO: "DPO",
  GROSS_MARGIN: "GROSS_MARGIN",
  EBITDA_MARGIN: "EBITDA_MARGIN",
  NET_MARGIN: "NET_MARGIN",
  ROA: "ROA",
  ROE: "ROE",
  INTEREST_COVERAGE: "INTEREST_COVERAGE",
};

function tryBenchmark(
  value: number,
  normalizedKey: string,
  naicsCode: string,
  revenue: number,
) {
  const benchmarkId = BENCHMARK_KEY_MAP[normalizedKey];
  if (!benchmarkId || !naicsCode) return null;
  return benchmarkRatio(value, benchmarkId, naicsCode, revenue);
}

// ---------------------------------------------------------------------------
// Policy evaluation
// ---------------------------------------------------------------------------

function getPolicyThresholds(
  key: string,
  policy: SpreadOutputInput["bank_policy"] & object,
  overrides: Record<string, number>,
): { policyMin: number | null; policyMax: number | null } {
  switch (key) {
    case "DSCR":
      return { policyMin: overrides["dscr_minimum"] ?? policy.dscr_minimum, policyMax: null };
    case "FCCR":
      return { policyMin: overrides["fccr_minimum"] ?? policy.fccr_minimum, policyMax: null };
    case "CURRENT_RATIO":
      return { policyMin: overrides["current_ratio_minimum"] ?? policy.current_ratio_minimum, policyMax: null };
    case "LTV":
      return { policyMin: null, policyMax: overrides["ltv_maximum"] ?? policy.ltv_maximum };
    case "LTC":
      return { policyMin: null, policyMax: overrides["ltc_maximum"] ?? policy.ltc_maximum };
    case "DEBT_TO_EBITDA":
      return { policyMin: null, policyMax: overrides["debt_ebitda_maximum"] ?? policy.debt_ebitda_maximum };
    default:
      return { policyMin: null, policyMax: null };
  }
}

function evaluatePolicy(
  value: number,
  key: string,
  policyMin: number | null,
  policyMax: number | null,
): boolean | null {
  if (policyMin !== null) return value >= policyMin;
  if (policyMax !== null) return value <= policyMax;
  return null;
}

// ---------------------------------------------------------------------------
// Trend
// ---------------------------------------------------------------------------

function getTrend(
  input: SpreadOutputInput,
  key: string,
): "improving" | "stable" | "deteriorating" | null {
  if (!input.trend_report) return null;

  const trendMap: Record<string, { direction: string | null } | undefined> = {
    DSCR: input.trend_report.trendDscr,
    DSO: input.trend_report.trendDso,
    DIO: input.trend_report.trendDio,
    DEBT_TO_EBITDA: input.trend_report.trendLeverage,
    GROSS_MARGIN: input.trend_report.trendGrossMargin,
    EBITDA_MARGIN: input.trend_report.trendGrossMargin,
  };

  const trend = trendMap[key];
  if (!trend?.direction) return null;

  const dir = trend.direction;
  // Map direction strings to our output
  if (dir === "POSITIVE" || dir === "IMPROVING" || dir === "EXPANDING" || dir === "GROWING") return "improving";
  if (dir === "NEUTRAL" || dir === "STABLE") return "stable";
  if (dir === "DECLINING" || dir === "DETERIORATING" || dir === "COMPRESSING" || dir === "WORSENING" || dir === "ERODING") return "deteriorating";
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getNum(ratios: Record<string, number | null>, key: string): number | null {
  const val = ratios[key];
  if (val !== null && val !== undefined && isFinite(val)) return val;
  return null;
}

function toNum(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isFinite(n) ? n : null;
}

function computeOverallAssessment(
  assessments: Array<"strong" | "adequate" | "weak" | "concerning">,
): "strong" | "adequate" | "marginal" | "insufficient" {
  if (assessments.length === 0) return "adequate";
  const rank: Record<string, number> = { concerning: 0, weak: 1, adequate: 2, strong: 3 };
  const lowest = Math.min(...assessments.map((a) => rank[a] ?? 2));
  if (lowest === 0) return "insufficient";
  if (lowest === 1) return "marginal";
  if (lowest === 3) return "strong";
  return "adequate";
}

function buildDefaultNarrative(key: string, value: number, assessment: RatioAssessment): string {
  const label = RATIO_LABELS[key] ?? key;
  const formatted = formatRatioValue(key, value);
  if (!assessment) return `${label} is ${formatted}.`;
  return `${label} of ${formatted} is assessed as ${assessment}.`;
}

function humanize(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
