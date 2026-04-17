import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { evaluateMetric } from "@/lib/metrics/evaluateMetric";
import type {
  RatioAnalysisRow,
  RatioCategory,
  RatioAssessment,
} from "@/lib/creditMemo/canonical/types";

// ---------------------------------------------------------------------------
// Fact keys this builder reads.
// These span base facts (TOTAL_REVENUE, EBITDA, …) and the persisted GCF
// ratios from Phase 86 (GCF_DSCR, GCF_GLOBAL_CASH_FLOW).
// ---------------------------------------------------------------------------

const RATIO_INPUT_FACT_KEYS = [
  // Income statement base
  "TOTAL_REVENUE", "COST_OF_GOODS_SOLD", "GROSS_PROFIT",
  "TOTAL_OPERATING_EXPENSES", "OPERATING_INCOME",
  "INTEREST_EXPENSE", "DEPRECIATION", "RENT_EXPENSE",
  "NET_INCOME", "EBITDA",
  // Balance sheet base
  "CASH_AND_EQUIVALENTS", "ACCOUNTS_RECEIVABLE", "INVENTORY",
  "TOTAL_CURRENT_ASSETS", "TOTAL_CURRENT_LIABILITIES",
  "ACCOUNTS_PAYABLE", "FIXED_ASSETS_NET", "INTANGIBLES_NET",
  "TOTAL_ASSETS", "TOTAL_LIABILITIES", "NET_WORTH",
  // Cash flow / DS
  "CASH_FLOW_AVAILABLE", "ANNUAL_DEBT_SERVICE",
  "ANNUAL_DEBT_SERVICE_STRESSED_300BPS",
  // Already-computed persisted ratios from Phase 86
  "GCF_DSCR", "GCF_GLOBAL_CASH_FLOW", "GCF_CASH_AVAILABLE",
  "DSCR", "DSCR_STRESSED_300BPS", "EXCESS_CASH_FLOW",
] as const;

// ---------------------------------------------------------------------------
// Helper metric IDs that must be evaluated before dependent ratios.
// The Metric Registry expresses these as named metrics whose expressions
// are themselves derivations from base facts. Adding their results to the
// facts map lets downstream metrics like CCC, FCCR, TIE, LIABILITIES_TO_TNW
// resolve in a single cascading pass.
// ---------------------------------------------------------------------------

const HELPER_METRICS_ORDER = [
  "QUICK_ASSETS",       // CURRENT_ASSETS - INVENTORY (Quick ratio input)
  "EBIT",               // NET_INCOME + INTEREST_EXPENSE (Interest coverage input)
  "FIXED_CHARGES",      // INTEREST_EXPENSE + RENT_EXPENSE (FCCR input)
  "TANGIBLE_NET_WORTH", // NET_WORTH - INTANGIBLES_NET (LIABILITIES_TO_TNW input)
  "DSO",                // AR / REVENUE * 365 (CCC input)
  "DIO",                // INVENTORY / COGS * 365 (CCC input)
  "DPO",                // AP / COGS * 365 (CCC input)
  "WORKING_CAPITAL",    // CA - CL (sales/WC + WC turnover input)
];

// ---------------------------------------------------------------------------
// Ratio spec — canonical suite displayed in the credit memo.
// Each entry names the metric registry id + display category/unit and a
// lightweight interpretation function.
// ---------------------------------------------------------------------------

type InterpretInput = {
  value: number;
  facts: Record<string, number | null>;
};

type InterpretResult = {
  assessment: RatioAssessment;
  interpretation: string;
  benchmarkNote: string | null;
};

type RatioSpec = {
  metricId: string;
  label: string;
  category: RatioCategory;
  unit: RatioAnalysisRow["unit"];
  /** Only present if the spec actually produces a visible row. */
  applicableWhen?: (facts: Record<string, number | null>) => boolean;
  interpret: (input: InterpretInput) => InterpretResult;
};

// ---------------------------------------------------------------------------
// Assessment helpers
// ---------------------------------------------------------------------------

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function fmtRatio(v: number): string {
  return v.toFixed(2);
}

function fmtMultiple(v: number): string {
  return `${v.toFixed(2)}x`;
}

function fmtDays(v: number): string {
  return `${Math.round(v)} days`;
}

function threeTier(
  value: number,
  strongAt: number,
  adequateAt: number,
  direction: "higher_is_better" | "lower_is_better",
  strongText: string,
  adequateText: string,
  weakText: string,
): { assessment: RatioAssessment; interpretation: string } {
  const isBetter = (test: number, target: number) =>
    direction === "higher_is_better" ? test >= target : test <= target;
  if (isBetter(value, strongAt)) return { assessment: "Strong", interpretation: strongText };
  if (isBetter(value, adequateAt)) return { assessment: "Adequate", interpretation: adequateText };
  return { assessment: "Weak", interpretation: weakText };
}

// ---------------------------------------------------------------------------
// Business-model detection — suppress irrelevant ratios cleanly.
// OPERATING w/ COGS + Inventory → full Activity suite
// Service company (no COGS/Inventory) → suppress DIO/DPO/CCC
// CRE-only deal → suppress all Activity + most Profitability
// ---------------------------------------------------------------------------

type BusinessModel = "OPERATING_COMPANY" | "REAL_ESTATE" | "MIXED";

function inferBusinessModel(facts: Record<string, number | null>): BusinessModel {
  const cogs = facts.COST_OF_GOODS_SOLD;
  const inventory = facts.INVENTORY;
  const revenue = facts.TOTAL_REVENUE;
  const rentalIncome = facts.CASH_FLOW_AVAILABLE; // GCF proxy — NOI from real estate

  const hasOpCo = (cogs !== null && cogs !== undefined && cogs > 0)
               || (revenue !== null && revenue !== undefined && revenue > 0);
  const hasCre = rentalIncome !== null && rentalIncome !== undefined && rentalIncome > 0
               && (!revenue || revenue === 0);

  if (hasOpCo && !hasCre) return "OPERATING_COMPANY";
  if (hasCre && !hasOpCo) return "REAL_ESTATE";
  return "MIXED";
}

function hasInventory(facts: Record<string, number | null>): boolean {
  const inv = facts.INVENTORY;
  return typeof inv === "number" && inv > 0;
}

function hasCogs(facts: Record<string, number | null>): boolean {
  const cogs = facts.COST_OF_GOODS_SOLD;
  return typeof cogs === "number" && cogs > 0;
}

// ---------------------------------------------------------------------------
// Canonical ratio spec list
// ---------------------------------------------------------------------------

const RATIO_SPECS: RatioSpec[] = [
  // ── LIQUIDITY ──────────────────────────────────────────────────────────
  {
    metricId: "CURRENT_RATIO",
    label: "Current Ratio",
    category: "Liquidity",
    unit: "ratio",
    interpret: ({ value }) => {
      const t = threeTier(value, 1.5, 1.0, "higher_is_better",
        `Strong short-term liquidity at ${fmtRatio(value)}.`,
        `Adequate short-term liquidity at ${fmtRatio(value)}.`,
        `Weak short-term liquidity at ${fmtRatio(value)} — below the 1.0x coverage floor.`);
      return { ...t, benchmarkNote: "Institutional floor: 1.0x. Healthy: ≥1.5x." };
    },
  },
  {
    metricId: "QUICK_RATIO",
    label: "Quick Ratio (Acid Test)",
    category: "Liquidity",
    unit: "ratio",
    interpret: ({ value }) => {
      const t = threeTier(value, 1.0, 0.5, "higher_is_better",
        `Strong immediate liquidity at ${fmtRatio(value)}.`,
        `Adequate immediate liquidity at ${fmtRatio(value)}.`,
        `Weak immediate liquidity at ${fmtRatio(value)} — reliant on inventory conversion.`);
      return { ...t, benchmarkNote: "Institutional floor: 0.5x. Healthy: ≥1.0x." };
    },
  },
  {
    metricId: "WORKING_CAPITAL",
    label: "Working Capital",
    category: "Liquidity",
    unit: "currency",
    interpret: ({ value }) => {
      if (value >= 0) {
        return {
          assessment: value > 0 ? "Strong" : "Adequate",
          interpretation: `Positive working capital of $${Math.round(value).toLocaleString()} supports operating funding needs.`,
          benchmarkNote: "Negative working capital indicates reliance on trade credit or short-term debt.",
        };
      }
      return {
        assessment: "Weak",
        interpretation: `Negative working capital of $${Math.round(value).toLocaleString()} indicates liquidity stress — current liabilities exceed current assets.`,
        benchmarkNote: "Negative working capital indicates reliance on trade credit or short-term debt.",
      };
    },
  },
  {
    metricId: "CASH_RATIO",
    label: "Cash Ratio",
    category: "Liquidity",
    unit: "ratio",
    interpret: ({ value }) => {
      const t = threeTier(value, 0.5, 0.2, "higher_is_better",
        `Strong cash position — ${fmtRatio(value)}x of current liabilities covered by cash alone.`,
        `Adequate cash position at ${fmtRatio(value)}x of current liabilities.`,
        `Thin cash coverage at ${fmtRatio(value)}x — dependent on AR/inventory conversion.`);
      return { ...t, benchmarkNote: "Conservative banks look for ≥0.2x." };
    },
  },
  {
    metricId: "DAYS_CASH_ON_HAND",
    label: "Days Cash on Hand",
    category: "Liquidity",
    unit: "days",
    interpret: ({ value }) => {
      const t = threeTier(value, 90, 30, "higher_is_better",
        `${Math.round(value)} days of cash runway — comfortable reserve.`,
        `${Math.round(value)} days of cash runway — adequate but not ample.`,
        `${Math.round(value)} days of cash runway — thin reserve; tight operating margin for disruption.`);
      return { ...t, benchmarkNote: "SBA lenders typically want ≥30 days; best-in-class ≥90 days." };
    },
  },

  // ── LEVERAGE ───────────────────────────────────────────────────────────
  {
    metricId: "DEBT_TO_EQUITY",
    label: "Debt / Worth",
    category: "Leverage",
    unit: "ratio",
    interpret: ({ value }) => {
      const t = threeTier(value, 1.5, 3.0, "lower_is_better",
        `Conservative leverage at ${fmtRatio(value)}x — borrower retains substantial equity cushion.`,
        `Moderate leverage at ${fmtRatio(value)}x.`,
        `Elevated leverage at ${fmtRatio(value)}x — equity cushion is thin relative to debt.`);
      return { ...t, benchmarkNote: "Institutional ceiling: 3.0x. Healthy: ≤1.5x." };
    },
  },
  {
    metricId: "FIXED_ASSETS_NW",
    label: "Fixed Assets / Net Worth",
    category: "Leverage",
    unit: "ratio",
    interpret: ({ value }) => {
      const t = threeTier(value, 0.75, 1.0, "lower_is_better",
        `Fixed assets at ${fmtRatio(value)}x net worth — low capital intensity, strong flexibility.`,
        `Fixed assets at ${fmtRatio(value)}x net worth — typical for capital-moderate businesses.`,
        `Fixed assets at ${fmtRatio(value)}x net worth — capital-heavy; limited equity buffer for operations.`);
      return { ...t, benchmarkNote: "Above 1.0x signals equity is tied up in long-lived assets." };
    },
  },
  {
    metricId: "DEBT_TO_EBITDA",
    label: "Debt / EBITDA Multiple",
    category: "Leverage",
    unit: "times",
    interpret: ({ value }) => {
      const t = threeTier(value, 3.0, 4.5, "lower_is_better",
        `Leverage multiple of ${fmtMultiple(value)} — well within investment-grade territory.`,
        `Leverage multiple of ${fmtMultiple(value)} — elevated but manageable.`,
        `Leverage multiple of ${fmtMultiple(value)} — above the 4.5x ceiling; refinance risk elevated.`);
      return { ...t, benchmarkNote: "Middle-market ceiling: 4.5x. Bank-favorable: ≤3.0x." };
    },
  },
  {
    metricId: "CL_NW",
    label: "Current Liabilities / Net Worth",
    category: "Leverage",
    unit: "ratio",
    interpret: ({ value }) => {
      const t = threeTier(value, 0.5, 1.0, "lower_is_better",
        `Current liabilities at ${fmtRatio(value)}x net worth — conservative short-term obligations.`,
        `Current liabilities at ${fmtRatio(value)}x net worth — moderate short-term burden.`,
        `Current liabilities at ${fmtRatio(value)}x net worth — short-term debt is a significant share of equity.`);
      return { ...t, benchmarkNote: "Above 1.0x indicates short-term debt is outpacing retained equity." };
    },
  },
  {
    metricId: "TANGIBLE_NET_WORTH",
    label: "Tangible Net Worth",
    category: "Leverage",
    unit: "currency",
    interpret: ({ value }) => {
      if (value >= 0) {
        return {
          assessment: "Adequate",
          interpretation: `Tangible net worth of $${Math.round(value).toLocaleString()} — equity backed by hard assets after stripping intangibles.`,
          benchmarkNote: null,
        };
      }
      return {
        assessment: "Weak",
        interpretation: `Negative tangible net worth of $${Math.round(value).toLocaleString()} — intangibles exceed total equity. Liquidation-basis cushion is negative.`,
        benchmarkNote: "Lenders typically require positive tangible net worth for asset-based coverage.",
      };
    },
  },
  {
    metricId: "LIABILITIES_TO_TNW",
    label: "Total Liabilities / Tangible Net Worth",
    category: "Leverage",
    unit: "ratio",
    interpret: ({ value }) => {
      const t = threeTier(value, 2.0, 4.0, "lower_is_better",
        `Debt-to-TNW of ${fmtRatio(value)}x — conservative given tangible backing.`,
        `Debt-to-TNW of ${fmtRatio(value)}x — manageable against tangible equity.`,
        `Debt-to-TNW of ${fmtRatio(value)}x — stretches the tangible equity base.`);
      return { ...t, benchmarkNote: "Commercial banks commonly cap at 3–4x." };
    },
  },

  // ── COVERAGE ───────────────────────────────────────────────────────────
  {
    metricId: "DSCR",
    label: "Debt Service Coverage (DSCR)",
    category: "Coverage",
    unit: "times",
    interpret: ({ value }) => {
      const t = threeTier(value, 1.5, 1.25, "higher_is_better",
        `DSCR of ${fmtMultiple(value)} — strong cushion above policy minimum.`,
        `DSCR of ${fmtMultiple(value)} — meets the 1.25x institutional minimum with limited cushion.`,
        `DSCR of ${fmtMultiple(value)} — below the 1.25x institutional minimum. Deal requires mitigants.`);
      return { ...t, benchmarkNote: "SBA/institutional minimum: 1.25x. Healthy: ≥1.50x." };
    },
  },
  {
    metricId: "DSCR_STRESSED_300BPS",
    label: "DSCR Stressed (+300 bps)",
    category: "Coverage",
    unit: "times",
    interpret: ({ value }) => {
      const t = threeTier(value, 1.25, 1.0, "higher_is_better",
        `Stressed DSCR of ${fmtMultiple(value)} — comfortably covers debt service at +300 bps.`,
        `Stressed DSCR of ${fmtMultiple(value)} — coverage tightens but remains above 1.0x under a 300 bps shock.`,
        `Stressed DSCR of ${fmtMultiple(value)} — falls below 1.0x under a 300 bps rate shock. Material rate risk.`);
      return { ...t, benchmarkNote: "Institutional stress floor: 1.0x at +300 bps." };
    },
  },
  {
    metricId: "INTEREST_COVERAGE",
    label: "Interest Coverage (TIE)",
    category: "Coverage",
    unit: "times",
    interpret: ({ value }) => {
      const t = threeTier(value, 5.0, 2.0, "higher_is_better",
        `EBIT covers interest ${fmtMultiple(value)} — deep cushion against earnings volatility.`,
        `EBIT covers interest ${fmtMultiple(value)} — adequate cushion against moderate earnings stress.`,
        `EBIT covers interest ${fmtMultiple(value)} — minimal cushion; any earnings shock impairs interest.`);
      return { ...t, benchmarkNote: "Bank-favorable: ≥5x. Floor: 2x." };
    },
  },
  {
    metricId: "FIXED_CHARGE_COVERAGE",
    label: "Fixed Charge Coverage (FCCR)",
    category: "Coverage",
    unit: "times",
    interpret: ({ value }) => {
      const t = threeTier(value, 1.5, 1.2, "higher_is_better",
        `FCCR of ${fmtMultiple(value)} — fixed obligations well-covered.`,
        `FCCR of ${fmtMultiple(value)} — meets the 1.2x covenant threshold with limited headroom.`,
        `FCCR of ${fmtMultiple(value)} — below standard 1.2x covenant. Elevated breach risk.`);
      return { ...t, benchmarkNote: "Standard loan covenant: 1.2x." };
    },
  },
  {
    metricId: "GCF_DSCR",
    label: "Global DSCR",
    category: "Coverage",
    unit: "times",
    interpret: ({ value }) => {
      const t = threeTier(value, 1.5, 1.25, "higher_is_better",
        `Global DSCR of ${fmtMultiple(value)} — business + guarantor cash flow provides strong coverage.`,
        `Global DSCR of ${fmtMultiple(value)} — combined coverage clears the institutional minimum.`,
        `Global DSCR of ${fmtMultiple(value)} — combined cash flow falls short of the 1.25x institutional minimum.`);
      return { ...t, benchmarkNote: "Global coverage captures guarantor + business cash flow per SBA SOP 50 10." };
    },
  },

  // ── PROFITABILITY ──────────────────────────────────────────────────────
  {
    metricId: "GROSS_MARGIN",
    label: "Gross Margin",
    category: "Profitability",
    unit: "percent",
    applicableWhen: (f) => hasCogs(f),
    interpret: ({ value }) => {
      if (value < 0) return {
        assessment: "Weak",
        interpretation: `Negative gross margin (${fmtPct(value)}) — COGS exceeds revenue. Operating model is not self-funding.`,
        benchmarkNote: "Benchmarks vary heavily by industry.",
      };
      const t = threeTier(value, 0.4, 0.2, "higher_is_better",
        `Gross margin of ${fmtPct(value)} — strong pricing power and cost control.`,
        `Gross margin of ${fmtPct(value)} — typical for the sector.`,
        `Gross margin of ${fmtPct(value)} — thin per-unit margin; limited absorption of fixed costs.`);
      return { ...t, benchmarkNote: "Benchmarks vary heavily by industry." };
    },
  },
  {
    metricId: "OPERATING_PROFIT_MARGIN",
    label: "Operating Profit Margin",
    category: "Profitability",
    unit: "percent",
    interpret: ({ value }) => {
      if (value < 0) return {
        assessment: "Weak",
        interpretation: `Negative operating margin (${fmtPct(value)}) — core operations are unprofitable.`,
        benchmarkNote: null,
      };
      const t = threeTier(value, 0.15, 0.05, "higher_is_better",
        `Operating margin of ${fmtPct(value)} — strong operating discipline.`,
        `Operating margin of ${fmtPct(value)} — adequate; comparable to sector norms.`,
        `Operating margin of ${fmtPct(value)} — limited operational cushion.`);
      return { ...t, benchmarkNote: null };
    },
  },
  {
    metricId: "EBITDA_MARGIN",
    label: "EBITDA Margin",
    category: "Profitability",
    unit: "percent",
    interpret: ({ value }) => {
      if (value < 0) return {
        assessment: "Weak",
        interpretation: `Negative EBITDA margin (${fmtPct(value)}) — cash-basis operating profit is negative.`,
        benchmarkNote: null,
      };
      const t = threeTier(value, 0.20, 0.10, "higher_is_better",
        `EBITDA margin of ${fmtPct(value)} — strong cash-basis profitability.`,
        `EBITDA margin of ${fmtPct(value)} — solid cash-basis profitability.`,
        `EBITDA margin of ${fmtPct(value)} — thin cash-basis margin; limited debt-service capacity.`);
      return { ...t, benchmarkNote: "Middle-market healthy: ≥20%. Institutional floor: ~10%." };
    },
  },
  {
    metricId: "NET_MARGIN",
    label: "Net Profit Margin",
    category: "Profitability",
    unit: "percent",
    interpret: ({ value }) => {
      if (value < 0) return {
        assessment: "Weak",
        interpretation: `Negative net margin (${fmtPct(value)}) — bottom-line losses after all expenses.`,
        benchmarkNote: null,
      };
      const t = threeTier(value, 0.10, 0.03, "higher_is_better",
        `Net margin of ${fmtPct(value)} — strong bottom-line profitability.`,
        `Net margin of ${fmtPct(value)} — acceptable bottom-line profitability.`,
        `Net margin of ${fmtPct(value)} — very thin bottom-line; highly sensitive to revenue shocks.`);
      return { ...t, benchmarkNote: null };
    },
  },
  {
    metricId: "ROA",
    label: "Return on Assets (ROA)",
    category: "Profitability",
    unit: "percent",
    interpret: ({ value }) => {
      if (value < 0) return {
        assessment: "Weak",
        interpretation: `Negative ROA (${fmtPct(value)}) — assets are generating losses.`,
        benchmarkNote: null,
      };
      const t = threeTier(value, 0.05, 0.01, "higher_is_better",
        `ROA of ${fmtPct(value)} — strong asset productivity.`,
        `ROA of ${fmtPct(value)} — typical asset productivity.`,
        `ROA of ${fmtPct(value)} — low asset productivity.`);
      return { ...t, benchmarkNote: null };
    },
  },
  {
    metricId: "ROE",
    label: "Return on Equity (ROE)",
    category: "Profitability",
    unit: "percent",
    interpret: ({ value }) => {
      if (value < 0) return {
        assessment: "Weak",
        interpretation: `Negative ROE (${fmtPct(value)}) — eroding equity base.`,
        benchmarkNote: null,
      };
      const t = threeTier(value, 0.15, 0.05, "higher_is_better",
        `ROE of ${fmtPct(value)} — strong return to equity holders.`,
        `ROE of ${fmtPct(value)} — adequate return to equity holders.`,
        `ROE of ${fmtPct(value)} — low return to equity holders.`);
      return { ...t, benchmarkNote: null };
    },
  },

  // ── ACTIVITY / EFFICIENCY ──────────────────────────────────────────────
  {
    metricId: "AR_DAYS",
    label: "AR Days (DSO)",
    category: "Activity",
    unit: "days",
    interpret: ({ value }) => {
      const t = threeTier(value, 30, 60, "lower_is_better",
        `Collecting in ${fmtDays(value)} — tight working-capital discipline.`,
        `Collecting in ${fmtDays(value)} — typical B2B collection cadence.`,
        `Collecting in ${fmtDays(value)} — slow collections; elevated working-capital need.`);
      return { ...t, benchmarkNote: "B2B sector typical: 30–60 days." };
    },
  },
  {
    metricId: "INVENTORY_TURNOVER",
    label: "Inventory Turnover",
    category: "Activity",
    unit: "times",
    applicableWhen: (f) => hasInventory(f) && hasCogs(f),
    interpret: ({ value }) => {
      const t = threeTier(value, 8, 4, "higher_is_better",
        `Inventory turns ${fmtMultiple(value)}/yr — efficient stock management.`,
        `Inventory turns ${fmtMultiple(value)}/yr — typical for the sector.`,
        `Inventory turns ${fmtMultiple(value)}/yr — slow-moving stock; risk of obsolescence.`);
      return { ...t, benchmarkNote: null };
    },
  },
  {
    metricId: "DIO",
    label: "Days Inventory Outstanding (DIO)",
    category: "Activity",
    unit: "days",
    applicableWhen: (f) => hasInventory(f) && hasCogs(f),
    interpret: ({ value }) => {
      const t = threeTier(value, 45, 90, "lower_is_better",
        `${fmtDays(value)} of inventory — tight stock control.`,
        `${fmtDays(value)} of inventory — typical for the sector.`,
        `${fmtDays(value)} of inventory — high days on hand; capital-intensive and obsolescence-exposed.`);
      return { ...t, benchmarkNote: null };
    },
  },
  {
    metricId: "DPO",
    label: "Days Payable Outstanding (DPO)",
    category: "Activity",
    unit: "days",
    applicableWhen: (f) => hasCogs(f),
    interpret: ({ value }) => {
      if (value > 90) return {
        assessment: "Weak",
        interpretation: `${fmtDays(value)} payable aging — may indicate supplier friction or stretched terms.`,
        benchmarkNote: "B2B sector typical: 30–60 days.",
      };
      if (value >= 30) return {
        assessment: "Adequate",
        interpretation: `${fmtDays(value)} payable aging — in line with sector norms.`,
        benchmarkNote: "B2B sector typical: 30–60 days.",
      };
      return {
        assessment: "Adequate",
        interpretation: `${fmtDays(value)} payable aging — pays suppliers quickly (may forego trade credit).`,
        benchmarkNote: "B2B sector typical: 30–60 days.",
      };
    },
  },
  {
    metricId: "CCC",
    label: "Cash Conversion Cycle",
    category: "Activity",
    unit: "days",
    applicableWhen: (f) => hasInventory(f) && hasCogs(f),
    interpret: ({ value }) => {
      const t = threeTier(value, 30, 60, "lower_is_better",
        `CCC of ${fmtDays(value)} — highly efficient working-capital cycle.`,
        `CCC of ${fmtDays(value)} — typical working-capital cycle.`,
        `CCC of ${fmtDays(value)} — long cash-tied-up cycle; working-capital hungry.`);
      return { ...t, benchmarkNote: "Lower is better. Negative CCC (Amazon-style) is best-in-class." };
    },
  },
];

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

type BuildArgs = {
  dealId: string;
  bankId: string;
};

/**
 * Phase 88 — build the full institutional ratio suite for the credit memo.
 *
 * Reads the latest-period facts from deal_financial_facts, pre-computes
 * helper metrics, then evaluates each ratio in the canonical suite.
 * Suppresses ratios that do not apply to the business model (e.g. inventory
 * turnover for a service company).
 */
export async function buildRatioAnalysisSuite(
  args: BuildArgs,
): Promise<RatioAnalysisRow[]> {
  const sb = supabaseAdmin();

  const { data: factRows, error } = await (sb as any)
    .from("deal_financial_facts")
    .select("fact_key, fact_value_num, fact_period_end")
    .eq("deal_id", args.dealId)
    .eq("bank_id", args.bankId)
    .eq("is_superseded", false)
    .neq("resolution_status", "rejected")
    .in("fact_key", RATIO_INPUT_FACT_KEYS as unknown as string[])
    .not("fact_value_num", "is", null)
    .order("fact_period_end", { ascending: false });

  if (error || !factRows || factRows.length === 0) return [];

  // Collapse to latest-period values: first occurrence wins since we sorted desc.
  const facts: Record<string, number | null> = {};
  let latestPeriodEnd: string | null = null;
  for (const row of factRows as any[]) {
    const key = String(row.fact_key);
    const v = row.fact_value_num;
    if (facts[key] !== undefined) continue;
    facts[key] = typeof v === "number" ? v : Number(v);
    if (!latestPeriodEnd && row.fact_period_end) {
      latestPeriodEnd = String(row.fact_period_end);
    }
  }

  // Pre-compute helper metrics so dependent ratios can resolve their inputs.
  for (const helperId of HELPER_METRICS_ORDER) {
    if (facts[helperId] !== undefined && facts[helperId] !== null) continue;
    const r = evaluateMetric(helperId, facts);
    if (r.value !== null) facts[helperId] = r.value;
  }

  const periodLabel = latestPeriodEnd
    ? (() => {
        const d = new Date(latestPeriodEnd!);
        if (!Number.isFinite(d.getTime())) return latestPeriodEnd!;
        const year = d.getUTCFullYear();
        const month = d.getUTCMonth() + 1;
        const day = d.getUTCDate();
        if (month === 12 && day === 31) return `FY ${year}`;
        return latestPeriodEnd!;
      })()
    : "Latest";

  const rows: RatioAnalysisRow[] = [];

  for (const spec of RATIO_SPECS) {
    if (spec.applicableWhen && !spec.applicableWhen(facts)) continue;

    const direct = facts[spec.metricId];
    let value: number | null;

    if (typeof direct === "number" && Number.isFinite(direct)) {
      value = direct;
    } else {
      const evalRes = evaluateMetric(spec.metricId, facts);
      value = evalRes.value;
    }

    // Suppress rows with no computable value — we never zero-fill.
    if (value === null) continue;

    const { assessment, interpretation, benchmarkNote } = spec.interpret({
      value,
      facts,
    });

    rows.push({
      metric: spec.label,
      category: spec.category,
      value,
      industry_avg: null,
      industry_source: null,
      unit: spec.unit,
      period_label: periodLabel,
      assessment,
      interpretation,
      benchmark_note: benchmarkNote,
    });
  }

  return rows;
}

export { inferBusinessModel };
