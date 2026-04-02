/* ------------------------------------------------------------------ */
/*  Lever Ranking — pure computation, no DB, no IO                    */
/* ------------------------------------------------------------------ */

import type { MetricSnapshot } from "./rootCauseTree";

export type RankedLever = {
  lever: string;
  description: string;
  impactMetric: string;
  estimatedImprovement: string;
  feasibility: "easy" | "moderate" | "hard";
  timeframe: "weeks" | "months" | "quarters";
  lenderCareScore: number; // 1–10
  rank: number;
};

/* ------------------------------------------------------------------ */
/*  Lever catalog                                                      */
/* ------------------------------------------------------------------ */

type LeverTemplate = {
  lever: string;
  description: string;
  impactMetric: string;
  estimatedImprovement: string;
  feasibility: "easy" | "moderate" | "hard";
  timeframe: "weeks" | "months" | "quarters";
  lenderCareScore: number;
  /** Metric keys that make this lever relevant */
  relevantWhen: string[];
  /** Return true if the lever applies given the metrics */
  isApplicable: (metrics: MetricSnapshot) => boolean;
};

const LEVER_CATALOG: LeverTemplate[] = [
  {
    lever: "reduce_discretionary_expenses",
    description:
      "Cut non-essential spending such as travel, entertainment, and subscriptions to improve margins.",
    impactMetric: "operating_expenses",
    estimatedImprovement: "5-15% reduction in discretionary line items",
    feasibility: "easy",
    timeframe: "weeks",
    lenderCareScore: 7,
    relevantWhen: ["operating_expenses", "net_margin", "dscr", "noi"],
    isApplicable: (m) =>
      metricBelow(m, "dscr") ||
      metricBelow(m, "net_margin") ||
      metricDeclining(m, "operating_expenses", true),
  },
  {
    lever: "accelerate_ar_collection",
    description:
      "Tighten payment terms and follow up on overdue invoices to improve cash conversion.",
    impactMetric: "ar_days",
    estimatedImprovement: "10-20 day reduction in AR days outstanding",
    feasibility: "moderate",
    timeframe: "weeks",
    lenderCareScore: 8,
    relevantWhen: ["ar_days", "current_ratio"],
    isApplicable: (m) => {
      const ar = m["ar_days"];
      return ar !== undefined && ar.value > 45;
    },
  },
  {
    lever: "renegotiate_vendor_terms",
    description:
      "Extend payment terms or negotiate volume discounts with key suppliers.",
    impactMetric: "operating_expenses",
    estimatedImprovement: "3-8% reduction in COGS or operating costs",
    feasibility: "moderate",
    timeframe: "months",
    lenderCareScore: 6,
    relevantWhen: ["operating_expenses", "gross_margin", "cost_of_goods"],
    isApplicable: (m) =>
      metricBelow(m, "gross_margin") || metricDeclining(m, "cost_of_goods", true),
  },
  {
    lever: "defer_capital_expenditure",
    description:
      "Postpone non-critical capital projects to preserve cash flow for debt service.",
    impactMetric: "capex",
    estimatedImprovement: "Frees up planned capex for debt service",
    feasibility: "moderate",
    timeframe: "months",
    lenderCareScore: 9,
    relevantWhen: ["capex", "dscr", "debt_service"],
    isApplicable: (m) => {
      const capex = m["capex"];
      return (capex !== undefined && capex.value > 0) || metricBelow(m, "dscr");
    },
  },
  {
    lever: "increase_pricing",
    description:
      "Raise prices on products or services where the market will bear it to improve revenue and margins.",
    impactMetric: "revenue",
    estimatedImprovement: "2-10% increase in gross revenue",
    feasibility: "hard",
    timeframe: "quarters",
    lenderCareScore: 8,
    relevantWhen: ["revenue", "gross_margin", "dscr"],
    isApplicable: (m) =>
      metricBelow(m, "gross_margin") || metricDeclining(m, "revenue", false),
  },
  {
    lever: "reduce_owner_draws",
    description:
      "Temporarily reduce owner distributions to keep more cash in the business for operations and debt service.",
    impactMetric: "owner_draws",
    estimatedImprovement: "Direct dollar-for-dollar improvement in cash available for debt service",
    feasibility: "easy",
    timeframe: "weeks",
    lenderCareScore: 10,
    relevantWhen: ["owner_draws", "dscr"],
    isApplicable: (m) => {
      const draws = m["owner_draws"];
      return (draws !== undefined && draws.value > 0) || metricBelow(m, "dscr");
    },
  },
  {
    lever: "improve_occupancy",
    description:
      "Fill vacant units or spaces to increase rental income and NOI.",
    impactMetric: "occupancy",
    estimatedImprovement: "5-15% increase in occupancy rate",
    feasibility: "moderate",
    timeframe: "months",
    lenderCareScore: 9,
    relevantWhen: ["occupancy", "noi", "revenue"],
    isApplicable: (m) => {
      const occ = m["occupancy"];
      return occ !== undefined && occ.value < 0.95;
    },
  },
  {
    lever: "refinance_existing_debt",
    description:
      "Consolidate or refinance high-rate debt to reduce total debt service burden.",
    impactMetric: "debt_service",
    estimatedImprovement: "10-25% reduction in annual debt service",
    feasibility: "hard",
    timeframe: "quarters",
    lenderCareScore: 7,
    relevantWhen: ["debt_service", "interest_expense", "dscr"],
    isApplicable: (m) => metricBelow(m, "dscr"),
  },
  {
    lever: "reduce_inventory_levels",
    description:
      "Optimize inventory to free up working capital without impacting operations.",
    impactMetric: "current_ratio",
    estimatedImprovement: "Improved cash position and working capital",
    feasibility: "moderate",
    timeframe: "months",
    lenderCareScore: 5,
    relevantWhen: ["current_ratio", "current_assets"],
    isApplicable: (m) => metricBelow(m, "current_ratio"),
  },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function metricBelow(m: MetricSnapshot, key: string): boolean {
  const d = m[key];
  if (!d || d.threshold === undefined) return false;
  return d.value < d.threshold;
}

function metricDeclining(
  m: MetricSnapshot,
  key: string,
  risingIsBad: boolean,
): boolean {
  const d = m[key];
  if (!d || d.priorValue === undefined || d.priorValue === 0) return false;
  const change = (d.value - d.priorValue) / Math.abs(d.priorValue);
  return risingIsBad ? change > 0.05 : change < -0.05;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

export function rankLevers(
  metrics: MetricSnapshot,
  constraints: string[],
): RankedLever[] {
  const constraintSet = new Set(constraints.map((c) => c.toLowerCase()));

  const applicable = LEVER_CATALOG.filter((t) => {
    // Skip if constrained out
    if (constraintSet.has(t.lever)) return false;
    return t.isApplicable(metrics);
  });

  // Sort by lenderCareScore desc, then feasibility (easy first)
  const feasibilityOrder: Record<string, number> = {
    easy: 0,
    moderate: 1,
    hard: 2,
  };

  applicable.sort((a, b) => {
    if (b.lenderCareScore !== a.lenderCareScore)
      return b.lenderCareScore - a.lenderCareScore;
    return feasibilityOrder[a.feasibility] - feasibilityOrder[b.feasibility];
  });

  return applicable.map((t, i) => ({
    lever: t.lever,
    description: t.description,
    impactMetric: t.impactMetric,
    estimatedImprovement: t.estimatedImprovement,
    feasibility: t.feasibility,
    timeframe: t.timeframe,
    lenderCareScore: t.lenderCareScore,
    rank: i + 1,
  }));
}
