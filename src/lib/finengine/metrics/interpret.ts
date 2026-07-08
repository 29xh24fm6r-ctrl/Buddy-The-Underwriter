/**
 * SPEC-FINENGINE-FULL-SPREAD-1 — Phase 5: the interpretation layer.
 *
 * Every metric the engine measures, it must also *explain*. `interpret()` maps a
 * computed result to a deterministic credit reading: what the metric means, which
 * direction is favorable, a strong/adequate/weak/flag rating against bank-grade
 * reference bands, and any red flags that fire. Policy-bearing metrics resolve
 * their pass/fail boundary from the registry (NG3 / guard G1) — this file imports
 * policyRegistry, so the descriptive reference bands below are interpretation
 * context, never the regulatory line of record.
 *
 * Pure — no DB. Deterministic — same inputs, same reading, every time.
 *
 * Industry context (optional): when the caller supplies a NAICS code + annual
 * revenue, a metric that the industry-benchmark registry covers is rated against
 * its REVENUE-TIERED PEER PERCENTILES instead of the fixed bands — a 40% gross
 * margin is weak for a distributor and elite for a restaurant. Without industry
 * context, behavior is exactly as before (fixed bands).
 */

import type { PolicyContext } from "@/lib/finengine/contracts";
import { resolvePolicy } from "@/lib/finengine/policyRegistry";
import { benchmarkRatio, type BenchmarkMetricId } from "@/lib/benchmarks/industryBenchmarks";

export type Rating = "strong" | "adequate" | "weak" | "flag" | "n/a";
export type FavorableDirection = "higher" | "lower" | "neutral";

export type IndustryContext = { naics: string; annualRevenue: number };

export type Interpretation = {
  metric: string;
  value: number | null;
  rating: Rating;
  favorable: FavorableDirection;
  meaning: string;
  signal: string;
  redFlags: string[];
  benchmark?: { label: string; value: number | null; axis?: string };
  /** Industry peer percentile (0–100) when rated against NAICS benchmarks. */
  percentile?: number;
};

/** finengine metric name → industry-benchmark metric id (where the registry covers it). */
const BENCHMARKABLE: Record<string, BenchmarkMetricId> = {
  GROSS_MARGIN: "GROSS_MARGIN", EBITDA_MARGIN: "EBITDA_MARGIN", NET_MARGIN: "NET_MARGIN",
  CURRENT_RATIO: "CURRENT_RATIO", QUICK_RATIO: "QUICK_RATIO", DEBT_TO_EQUITY: "DEBT_TO_EQUITY",
  DSCR: "DSCR", GCF_DSCR: "DSCR", DSO: "DSO", DIO: "DIO", DPO: "DPO",
  INVENTORY_TURNOVER: "INVENTORY_TURNOVER", LEVERAGE_TOTAL: "DEBT_TO_EBITDA",
  ROA: "ROA", ROE: "ROE", ICR: "INTEREST_COVERAGE",
};

/** Map the benchmark registry's assessment onto our rating vocabulary. */
function ratingFromAssessment(a: "strong" | "adequate" | "weak" | "concerning"): Rating {
  return a === "concerning" ? "flag" : a;
}

/** Anything carrying a metric name + scalar value (MetricResult / Structural / DuPont / Altman). */
type Interpretable = { metric: string; value?: number | null; zone?: string; driver?: string | null };

type Bands = { strong: number; adequate: number; weak: number };

type Rule = {
  meaning: string;
  favorable: FavorableDirection;
  /** Registry axis whose effective value is the policy pass/fail boundary. */
  policyAxis?: string;
  /** Descriptive reference bands (industry/credit context — NOT policy). */
  bands?: Bands;
  /** Red flag when the value is at/below (favorable=higher) or at/above (favorable=lower) this. */
  redFlagAt?: number;
  /** Negative dollar values flag (used for net-worth/working-capital dollar metrics). */
  flagWhenNegative?: boolean;
};

// ---------------------------------------------------------------------------
// The interpretation table — §7. Bands are direction-aware (see rateByBands).
// ---------------------------------------------------------------------------

const RULES: Record<string, Rule> = {
  // ---- Liquidity ----
  CURRENT_RATIO: { meaning: "Short-term assets covering short-term obligations.", favorable: "higher", policyAxis: "current_ratio_min", bands: { strong: 2.0, adequate: 1.5, weak: 1.0 }, redFlagAt: 1.0 },
  QUICK_RATIO: { meaning: "Liquidity excluding inventory (the acid test).", favorable: "higher", policyAxis: "quick_ratio_min", bands: { strong: 1.5, adequate: 1.0, weak: 0.8 }, redFlagAt: 0.8 },
  CASH_RATIO: { meaning: "Cash-only coverage of current liabilities.", favorable: "higher", bands: { strong: 0.5, adequate: 0.2, weak: 0.1 } },
  NET_WORKING_CAPITAL: { meaning: "Dollar cushion funding the operating cycle.", favorable: "higher", flagWhenNegative: true },
  DEFENSIVE_INTERVAL_DAYS: { meaning: "Survival runway in days with no new inflows.", favorable: "higher", bands: { strong: 90, adequate: 30, weak: 15 } },
  WC_TO_SALES: { meaning: "Working-capital intensity of revenue.", favorable: "neutral" },

  // ---- Activity / turnover ----
  AR_TURNOVER: { meaning: "Times receivables are collected per year.", favorable: "higher", bands: { strong: 12, adequate: 8, weak: 5 } },
  DSO: { meaning: "Average days to collect receivables.", favorable: "lower", bands: { strong: 30, adequate: 45, weak: 60 }, redFlagAt: 90 },
  INVENTORY_TURNOVER: { meaning: "Times inventory is sold and replaced per year.", favorable: "higher", bands: { strong: 8, adequate: 5, weak: 3 } },
  DIO: { meaning: "Average days inventory is held.", favorable: "lower", bands: { strong: 45, adequate: 75, weak: 120 } },
  AP_TURNOVER: { meaning: "Times payables are paid per year.", favorable: "neutral" },
  DPO: { meaning: "Average days to pay suppliers (rising DPO can signal stretching).", favorable: "neutral" },
  OPERATING_CYCLE_DAYS: { meaning: "Days from inventory purchase to cash collection (DSO + DIO).", favorable: "lower", bands: { strong: 60, adequate: 120, weak: 180 } },
  CASH_CONVERSION_CYCLE: { meaning: "Days cash is locked in operations (negative = supplier-financed).", favorable: "lower", bands: { strong: 30, adequate: 90, weak: 150 } },
  ASSET_TURNOVER: { meaning: "Revenue generated per dollar of assets.", favorable: "higher", bands: { strong: 2.0, adequate: 1.0, weak: 0.5 } },
  FIXED_ASSET_TURNOVER: { meaning: "Revenue generated per dollar of fixed assets.", favorable: "higher", bands: { strong: 4.0, adequate: 2.0, weak: 1.0 } },
  WC_TURNOVER: { meaning: "Revenue generated per dollar of working capital.", favorable: "neutral" },

  // ---- Balance-sheet leverage / solvency ----
  // flagWhenNegative marks favorable-lower ratios whose negative value can ONLY mean a negative
  // denominator (negative equity/net-worth or negative EBITDA) — an insolvent/cash-burning obligor.
  DEBT_TO_EQUITY: { meaning: "Creditor money vs owner money.", favorable: "lower", policyAxis: "debt_to_equity_max", bands: { strong: 1.0, adequate: 2.0, weak: 3.0 }, flagWhenNegative: true },
  DEBT_TO_WORTH: { meaning: "Loss cushion behind creditors.", favorable: "lower", policyAxis: "debt_to_worth_max", bands: { strong: 1.5, adequate: 3.0, weak: 4.0 }, flagWhenNegative: true },
  DEBT_TO_ASSETS: { meaning: "Share of assets financed by funded debt.", favorable: "lower", policyAxis: "debt_to_assets_max", bands: { strong: 0.4, adequate: 0.6, weak: 0.8 } },
  LIABILITIES_TO_ASSETS: { meaning: "Share of assets financed by all liabilities.", favorable: "lower", bands: { strong: 0.4, adequate: 0.6, weak: 0.8 } },
  DEBT_TO_CAPITAL: { meaning: "Debt share of total capitalization.", favorable: "lower", bands: { strong: 0.3, adequate: 0.5, weak: 0.6 } },
  LTD_TO_CAPITAL: { meaning: "Long-term debt share of permanent capital.", favorable: "lower", bands: { strong: 0.3, adequate: 0.4, weak: 0.5 } },
  EQUITY_RATIO: { meaning: "Owner-funded share of the balance sheet.", favorable: "higher", bands: { strong: 0.5, adequate: 0.3, weak: 0.2 }, flagWhenNegative: true },
  EQUITY_MULTIPLIER: { meaning: "The leverage factor in DuPont ROE.", favorable: "lower", bands: { strong: 1.5, adequate: 2.5, weak: 4.0 }, flagWhenNegative: true },
  DEBT_TO_ETNW: { meaning: "Truest liquidation-scenario leverage (debt ÷ effective TNW).", favorable: "lower", policyAxis: "debt_to_etnw_max", bands: { strong: 0.75, adequate: 1.0, weak: 1.3 }, flagWhenNegative: true },
  DEBT_TO_TANGIBLE_NET_WORTH: { meaning: "Leverage against tangible net worth.", favorable: "lower", bands: { strong: 1.5, adequate: 3.0, weak: 4.0 }, flagWhenNegative: true },
  LEVERAGE_TOTAL: { meaning: "Total debt ÷ EBITDA — years of cash flow to repay all debt.", favorable: "lower", policyAxis: "leverage_max", bands: { strong: 2.0, adequate: 3.5, weak: 4.5 }, flagWhenNegative: true },
  LEVERAGE_TOTAL_NET: { meaning: "Cash-netted leverage (debt − cash) ÷ EBITDA.", favorable: "lower", policyAxis: "leverage_max", bands: { strong: 1.5, adequate: 3.0, weak: 4.5 } },
  LEVERAGE_SENIOR: { meaning: "Senior debt ÷ EBITDA.", favorable: "lower", policyAxis: "leverage_max", bands: { strong: 1.5, adequate: 2.5, weak: 3.5 }, flagWhenNegative: true },

  // ---- Coverage ----
  DSCR: { meaning: "Cash available ÷ GLOBAL debt service.", favorable: "higher", policyAxis: "dscr_floor", bands: { strong: 1.5, adequate: 1.25, weak: 1.1 } },
  GCF_DSCR: { meaning: "Global cash ÷ global debt service.", favorable: "higher", policyAxis: "dscr_floor", bands: { strong: 1.5, adequate: 1.25, weak: 1.1 } },
  PROPOSED_LOAN_COVERAGE: { meaning: "Coverage of the proposed loan ONLY (not DSCR).", favorable: "higher", bands: { strong: 1.5, adequate: 1.25, weak: 1.1 } },
  FCCR: { meaning: "Fixed-charge coverage (debt service + rent).", favorable: "higher", policyAxis: "fccr_floor", bands: { strong: 1.5, adequate: 1.25, weak: 1.15 } },
  ICR: { meaning: "EBIT ÷ interest expense.", favorable: "higher", bands: { strong: 3.0, adequate: 2.0, weak: 1.5 } },
  DEBT_YIELD: { meaning: "NOI ÷ loan amount — leverage-neutral CRE cushion.", favorable: "higher", bands: { strong: 0.12, adequate: 0.10, weak: 0.08 } },
  LTV: { meaning: "Loan amount ÷ collateral value.", favorable: "lower", policyAxis: "ltv_max", bands: { strong: 0.6, adequate: 0.7, weak: 0.75 } },
  CAP_RATE: { meaning: "NOI ÷ property value (market-yield context).", favorable: "neutral" },

  // ---- Profitability ----
  GROSS_MARGIN: { meaning: "Pricing power / production efficiency.", favorable: "higher", bands: { strong: 0.4, adequate: 0.25, weak: 0.15 } },
  OPERATING_MARGIN: { meaning: "Profitability of core operations.", favorable: "higher", bands: { strong: 0.15, adequate: 0.08, weak: 0.03 } },
  NET_MARGIN: { meaning: "Bottom-line profitability per revenue dollar.", favorable: "higher", bands: { strong: 0.1, adequate: 0.05, weak: 0.02 }, redFlagAt: 0 },
  EBITDA_MARGIN: { meaning: "Cash-operating profitability.", favorable: "higher", bands: { strong: 0.15, adequate: 0.1, weak: 0.05 } },
  PRETAX_MARGIN: { meaning: "Pretax profitability per revenue dollar.", favorable: "higher", bands: { strong: 0.1, adequate: 0.05, weak: 0.02 } },
  OPEX_RATIO: { meaning: "Operating expenses ÷ revenue (cost discipline).", favorable: "lower", bands: { strong: 0.2, adequate: 0.35, weak: 0.5 } },
  ROA: { meaning: "Net income ÷ average total assets.", favorable: "higher", bands: { strong: 0.08, adequate: 0.04, weak: 0.01 } },
  ROE: { meaning: "Net income ÷ average equity.", favorable: "higher", bands: { strong: 0.18, adequate: 0.1, weak: 0.05 } },
  ROIC: { meaning: "NOPAT ÷ invested capital (return above the cost of capital).", favorable: "higher", bands: { strong: 0.12, adequate: 0.08, weak: 0.04 } },
  ROCE: { meaning: "EBIT ÷ capital employed.", favorable: "higher", bands: { strong: 0.15, adequate: 0.08, weak: 0.04 } },

  // ---- Asset quality / net worth ----
  TANGIBLE_NET_WORTH: { meaning: "Net worth excluding intangibles — the real equity.", favorable: "higher", flagWhenNegative: true },
  EFFECTIVE_TANGIBLE_NET_WORTH: { meaning: "Tangible net worth adjusted for insiders + sub debt.", favorable: "higher", flagWhenNegative: true },
  ADJUSTED_NET_WORTH: { meaning: "Tangible net worth net of asset-quality haircuts.", favorable: "higher", flagWhenNegative: true },
  AR_DILUTION: { meaning: "Non-cash AR reductions eroding collateral value.", favorable: "lower", bands: { strong: 0.02, adequate: 0.05, weak: 0.1 } },
  FIXED_ASSET_AGE: { meaning: "Accumulated depreciation ÷ gross PP&E (replacement-capex risk).", favorable: "lower", bands: { strong: 0.3, adequate: 0.5, weak: 0.7 } },
  NET_TO_GROSS_PPE: { meaning: "Remaining useful life of the asset base.", favorable: "higher", bands: { strong: 0.6, adequate: 0.4, weak: 0.25 } },
  ALLOWANCE_ADEQUACY: { meaning: "Allowance ÷ (AR × historical loss rate); <1.0 = under-reserved.", favorable: "higher", bands: { strong: 1.2, adequate: 1.0, weak: 0.8 }, redFlagAt: 1.0 },

  // ---- Structural / temporal (descriptive) ----
  COMMON_SIZE_BALANCE_SHEET: { meaning: "Capital structure & asset mix as fractions of total assets.", favorable: "neutral" },
  COMMON_SIZE_INCOME: { meaning: "Cost structure & margin waterfall as fractions of revenue.", favorable: "neutral" },
  HORIZONTAL_ANALYSIS: { meaning: "Period-over-period change in a line item.", favorable: "neutral" },
  TREND: { meaning: "Trajectory across periods (monotonic vs erratic).", favorable: "neutral" },
  GROWTH_YOY: { meaning: "Year-over-year growth rate.", favorable: "higher", redFlagAt: 0 },
  CAGR: { meaning: "Smoothed compound annual growth rate.", favorable: "higher" },
  PEER_BENCHMARK: { meaning: "Subject value relative to the peer median.", favorable: "neutral" },
};

// ---------------------------------------------------------------------------
// Special handlers — zone/driver/residual metrics that don't fit the band model
// ---------------------------------------------------------------------------

const SPECIAL: Record<string, (r: Interpretable) => Pick<Interpretation, "rating" | "signal" | "redFlags" | "favorable" | "meaning"> > = {
  ALTMAN_Z_PRIME: (r) => altman(r),
  ALTMAN_Z_DOUBLE_PRIME: (r) => altman(r),
  ROE_DUPONT: (r) => {
    const driver = r.driver ?? null;
    const leverageDriven = driver === "leverage";
    return {
      meaning: "ROE decomposed into margin × efficiency × leverage; leverage-driven ROE is lower quality.",
      favorable: "higher",
      rating: driver == null ? "n/a" : leverageDriven ? "weak" : "adequate",
      signal: driver == null ? "ROE driver indeterminate." : `ROE is ${driver}-driven${leverageDriven ? " — lower-quality, leverage-dependent return." : "."}`,
      redFlags: leverageDriven ? ["ROE is driven by financial leverage, not operating performance — return quality is low and rate-sensitive."] : [],
    };
  },
  NET_WORTH_RECONCILIATION: (r) => {
    const v = r.value ?? null;
    const undisclosed = v != null && Math.abs(v) > 1; // dollar tolerance
    return {
      meaning: "Implied vs reported distributions; a non-zero residual flags undisclosed leakage.",
      favorable: "neutral",
      rating: v == null ? "n/a" : undisclosed ? "flag" : "strong",
      signal: v == null ? "Reconciliation inputs incomplete." : undisclosed ? `Undisclosed distributions of ${Math.round(v).toLocaleString()} detected — equity walk does not tie.` : "Equity walk ties to reported distributions.",
      redFlags: undisclosed ? [`Net-worth reconciliation residual ${Math.round(v).toLocaleString()} — possible undisclosed distributions / fraud signal.`] : [],
    };
  },
};

function altman(r: Interpretable): Pick<Interpretation, "rating" | "signal" | "redFlags" | "favorable" | "meaning"> {
  const zone = r.zone ?? "unknown";
  const rating: Rating = zone === "safe" ? "strong" : zone === "gray" ? "weak" : zone === "distress" ? "flag" : "n/a";
  return {
    meaning: "Altman distress score — composite bankruptcy-probability zone.",
    favorable: "higher",
    rating,
    signal: zone === "unknown" ? "Score indeterminate (missing inputs)." : `Altman zone: ${zone}${zone === "distress" ? " — elevated bankruptcy probability." : zone === "safe" ? " — low distress probability." : " — monitor."}`,
    redFlags: zone === "distress" ? ["Altman score in the distress zone — heightened default/bankruptcy probability."] : [],
  };
}

// ---------------------------------------------------------------------------
// Generic rater
// ---------------------------------------------------------------------------

function rateByBands(value: number, rule: Rule): Rating {
  // SPEC-CURRENT-STAGE-AUDIT-FIX-2: for favorable-lower leverage/solvency ratios (debt÷EBITDA,
  // debt÷equity, assets÷equity), a NEGATIVE value can only arise from a negative denominator —
  // negative EBITDA or negative equity — i.e. the single worst credit scenario. The favorable-lower
  // band test (value <= b.strong) would otherwise read that negative number as "better than strong",
  // labelling an insolvent / cash-burning obligor as the best credit. Rules that opt in via
  // flagWhenNegative force the worst rating instead. (Net-debt ratios are NOT marked, because a
  // negative there can legitimately mean a net-cash position.)
  if (rule.flagWhenNegative && value < 0) return "flag";
  const b = rule.bands;
  if (!b) return rule.favorable === "neutral" ? "n/a" : value >= 0 || rule.favorable === "lower" ? "adequate" : "flag";
  if (rule.favorable === "higher") {
    if (value >= b.strong) return "strong";
    if (value >= b.adequate) return "adequate";
    if (value >= b.weak) return "weak";
    return "flag";
  }
  // favorable === 'lower'
  if (value <= b.strong) return "strong";
  if (value <= b.adequate) return "adequate";
  if (value <= b.weak) return "weak";
  return "flag";
}

/** True when the value violates the registry policy boundary (floor breached / cap exceeded). */
function policyBreached(value: number, axis: string, ctx?: PolicyContext): { breached: boolean; effective: number | null; direction: string } {
  const p = resolvePolicy(axis, ctx);
  if (p.effective == null) return { breached: false, effective: null, direction: p.direction };
  const breached = p.direction === "floor" ? value < p.effective : value > p.effective;
  return { breached, effective: p.effective, direction: p.direction };
}

/**
 * Interpret a computed result deterministically. Accepts any object carrying a
 * `metric` name and (where scalar) a `value`; AltmanResult/DuPontResult carry
 * `zone`/`driver` consumed by the special handlers.
 */
export function interpret(result: Interpretable, opts?: { ctx?: PolicyContext; industry?: IndustryContext }): Interpretation {
  const metric = result.metric;
  const value = result.value ?? null;

  const special = SPECIAL[metric];
  if (special) {
    const s = special(result);
    return { metric, value, rating: s.rating, favorable: s.favorable, meaning: s.meaning, signal: s.signal, redFlags: s.redFlags };
  }

  const rule = RULES[metric];
  if (!rule) {
    return { metric, value, rating: "n/a", favorable: "neutral", meaning: `No interpretation registered for ${metric}.`, signal: "Uninterpreted metric.", redFlags: [] };
  }

  const redFlags: string[] = [];
  let rating: Rating;
  let signal: string;

  if (value == null) {
    rating = "n/a";
    signal = "Value unavailable — insufficient inputs to interpret.";
  } else if (rule.favorable === "neutral") {
    rating = "n/a";
    signal = `${metric} = ${round(value)} (descriptive — no favorable direction).`;
  } else {
    rating = rateByBands(value, rule);
    signal = `${metric} = ${round(value)} — ${rating} (${rule.favorable} is favorable).`;
  }

  // Red flags: explicit threshold, negative-dollar, and policy breach.
  if (value != null) {
    if (rule.flagWhenNegative && value < 0) redFlags.push(`${metric} is negative (${round(value)}) — erosion of cushion.`);
    if (rule.redFlagAt != null) {
      const crossed = rule.favorable === "lower" ? value >= rule.redFlagAt : value <= rule.redFlagAt;
      if (crossed) redFlags.push(`${metric} crossed its red-flag threshold (${round(value)} vs ${rule.redFlagAt}).`);
    }
  }

  let benchmark: Interpretation["benchmark"];
  if (rule.policyAxis && value != null) {
    const { breached, effective } = policyBreached(value, rule.policyAxis, opts?.ctx);
    benchmark = { label: "policy", value: effective, axis: rule.policyAxis };
    if (breached) {
      redFlags.push(`${metric} (${round(value)}) breaches policy ${rule.policyAxis} (effective ${effective}).`);
      if (rating === "strong" || rating === "adequate") rating = "weak";
    }
  } else if (rule.bands) {
    benchmark = { label: "reference", value: rule.bands.adequate };
  }

  // Industry overlay: rate against revenue-tiered NAICS peer percentiles when the
  // caller supplies industry context and the benchmark registry covers the metric.
  // The fixed-band rating remains the floor (a registry policy breach already
  // demoted it); the industry assessment refines it where peers say otherwise.
  let percentile: number | undefined;
  const benchId = BENCHMARKABLE[metric];
  if (benchId && value != null && opts?.industry) {
    const b = benchmarkRatio(value, benchId, opts.industry.naics, opts.industry.annualRevenue);
    if (b) {
      percentile = b.percentile;
      const industryRating = ratingFromAssessment(b.assessment);
      // Don't let the industry overlay upgrade past a policy breach (keep the conservative floor).
      const policyBreach = benchmark?.label === "policy" && (rating === "weak" || rating === "flag");
      if (!policyBreach) rating = industryRating;
      benchmark = { label: `industry NAICS ${opts.industry.naics} (p50)`, value: b.peerMedian };
      signal = `${metric} = ${round(value)} — ${rating}; ${ordinal(b.percentile)} percentile vs NAICS ${opts.industry.naics} peers (median ${round(b.peerMedian)}).`;
    }
  }

  return { metric, value, rating, favorable: rule.favorable, meaning: rule.meaning, signal, redFlags, benchmark, percentile };
}

function ordinal(p: number): string {
  const n = Math.round(p);
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

function round(v: number): string {
  return Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : (Math.round(v * 1000) / 1000).toString();
}

/** Every metric name this layer can interpret (band rules + special handlers). */
export function interpretableMetrics(): string[] {
  return [...new Set([...Object.keys(RULES), ...Object.keys(SPECIAL)])];
}

export { RULES as INTERPRETATION_RULES, SPECIAL as INTERPRETATION_SPECIAL };
