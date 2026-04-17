import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { evaluateMetric } from "@/lib/metrics/evaluateMetric";
import type {
  RatioAnalysisRow,
  RatioCategory,
  RatioAssessment,
} from "@/lib/creditMemo/canonical/types";

// ---------------------------------------------------------------------------
// Phase 91 Part A — Deal-Specific Interpretations
//
// DealContext carries the facts each interpret() function needs to produce
// committee-grade, borrower-specific prose instead of generic templates.
// Every field is optional / nullable — when a field is absent, the
// interpretation falls back to the phrasing used before Phase 91.
// ---------------------------------------------------------------------------

export type DealContext = {
  borrowerName: string | null;
  loanAmountDollars: number | null;
  annualDebtServiceDollars: number | null;
  revenueDollars: number | null;
  ebitdaDollars: number | null;
  businessType: string | null;
  seasonalityNote: string | null;
  stressBreakevenRevenue: number | null;
  stressBreakevenEbitda125x: number | null;
};

const EMPTY_DEAL_CONTEXT: DealContext = {
  borrowerName: null,
  loanAmountDollars: null,
  annualDebtServiceDollars: null,
  revenueDollars: null,
  ebitdaDollars: null,
  businessType: null,
  seasonalityNote: null,
  stressBreakevenRevenue: null,
  stressBreakevenEbitda125x: null,
};

// ---------------------------------------------------------------------------
// Fact keys read from deal_financial_facts
// ---------------------------------------------------------------------------

const RATIO_INPUT_FACT_KEYS = [
  "TOTAL_REVENUE", "COST_OF_GOODS_SOLD", "GROSS_PROFIT",
  "TOTAL_OPERATING_EXPENSES", "OPERATING_INCOME",
  "INTEREST_EXPENSE", "DEPRECIATION", "RENT_EXPENSE",
  "NET_INCOME", "EBITDA",
  "CASH_AND_EQUIVALENTS", "ACCOUNTS_RECEIVABLE", "INVENTORY",
  "TOTAL_CURRENT_ASSETS", "TOTAL_CURRENT_LIABILITIES",
  "ACCOUNTS_PAYABLE", "FIXED_ASSETS_NET", "INTANGIBLES_NET",
  "TOTAL_ASSETS", "TOTAL_LIABILITIES", "NET_WORTH",
  "CASH_FLOW_AVAILABLE", "ANNUAL_DEBT_SERVICE",
  "ANNUAL_DEBT_SERVICE_STRESSED_300BPS",
  "GCF_DSCR", "GCF_GLOBAL_CASH_FLOW", "GCF_CASH_AVAILABLE",
  "DSCR", "DSCR_STRESSED_300BPS", "EXCESS_CASH_FLOW",
] as const;

// ---------------------------------------------------------------------------
// Helper metrics evaluated before dependent ratios
// ---------------------------------------------------------------------------

const HELPER_METRICS_ORDER = [
  "QUICK_ASSETS", "EBIT", "FIXED_CHARGES", "TANGIBLE_NET_WORTH",
  "DSO", "DIO", "DPO", "WORKING_CAPITAL",
];

// ---------------------------------------------------------------------------
// Formatting helpers
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

function fmt$(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 10_000) return `$${Math.round(v / 1_000)}K`;
  return `$${Math.round(v).toLocaleString()}`;
}

/** Name used to start a deal-specific sentence. Falls back to "The borrower" when no name is known. */
function who(deal: DealContext): string {
  const name = deal.borrowerName?.trim();
  return name && name.length > 0 ? name : "The borrower";
}

/** Lowercase version used mid-sentence. */
function whoLower(deal: DealContext): string {
  const name = deal.borrowerName?.trim();
  return name && name.length > 0 ? name : "the borrower";
}

/** Human-readable short business description, for mid-sentence use. Returns "" if unknown. */
function businessTypeClause(deal: DealContext): string {
  const t = deal.businessType?.trim();
  if (!t) return "";
  const short = t.length > 70 ? t.slice(0, 67).trim() + "…" : t;
  return ` (${short})`;
}

/**
 * Compute the revenue-decline percentage to hit the 1.25x DSCR breakeven.
 * Returns null if the required facts are missing. Value returned is a
 * percent scalar, e.g. 22.3 (not 0.223).
 */
function revenueDeclineToBreachFloor(deal: DealContext): number | null {
  const ebitda = deal.ebitdaDollars;
  const breakeven = deal.stressBreakevenEbitda125x;
  if (ebitda === null || breakeven === null) return null;
  if (ebitda <= 0) return null;
  const cushion = ebitda - breakeven;
  if (cushion <= 0) return 0;
  return (cushion / ebitda) * 100;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type InterpretInput = {
  value: number;
  facts: Record<string, number | null>;
  deal: DealContext;
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
  applicableWhen?: (facts: Record<string, number | null>) => boolean;
  interpret: (input: InterpretInput) => InterpretResult;
};

// ---------------------------------------------------------------------------
// Assessment picker (deterministic — only the text varies with deal context)
// ---------------------------------------------------------------------------

function pickAssessment(
  value: number,
  strongAt: number,
  adequateAt: number,
  direction: "higher_is_better" | "lower_is_better",
): RatioAssessment {
  const isBetter = (test: number, target: number) =>
    direction === "higher_is_better" ? test >= target : test <= target;
  if (isBetter(value, strongAt)) return "Strong";
  if (isBetter(value, adequateAt)) return "Adequate";
  return "Weak";
}

// ---------------------------------------------------------------------------
// Business-model detection (unchanged from Phase 88)
// ---------------------------------------------------------------------------

type BusinessModel = "OPERATING_COMPANY" | "REAL_ESTATE" | "MIXED";

function inferBusinessModel(facts: Record<string, number | null>): BusinessModel {
  const cogs = facts.COST_OF_GOODS_SOLD;
  const revenue = facts.TOTAL_REVENUE;
  const rentalIncome = facts.CASH_FLOW_AVAILABLE;
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
// Canonical ratio spec list — deal-specific interpretations
// ---------------------------------------------------------------------------

const RATIO_SPECS: RatioSpec[] = [
  // ── LIQUIDITY ──────────────────────────────────────────────────────────
  {
    metricId: "CURRENT_RATIO",
    label: "Current Ratio",
    category: "Liquidity",
    unit: "ratio",
    interpret: ({ value, facts, deal }) => {
      const assessment = pickAssessment(value, 1.5, 1.0, "higher_is_better");
      const ca = facts.TOTAL_CURRENT_ASSETS;
      const cl = facts.TOTAL_CURRENT_LIABILITIES;
      const seasonalNote = deal.seasonalityNote?.trim()
        ? ` The ${deal.seasonalityNote.toLowerCase()} seasonality pattern means this cushion must cover fixed costs through the off-season.`
        : "";

      let interpretation: string;
      if (assessment === "Strong") {
        if (ca !== null && ca !== undefined && cl !== null && cl !== undefined) {
          interpretation = `${who(deal)} holds ${fmt$(ca)} in current assets against ${fmt$(cl)} in near-term obligations (${fmtMultiple(value)}), providing comfortable runway for operating cycles.${seasonalNote}`;
        } else {
          interpretation = `${who(deal)} carries ${fmtMultiple(value)} current assets per dollar of short-term debt — strong liquidity buffer for operating needs.${seasonalNote}`;
        }
      } else if (assessment === "Adequate") {
        if (ca !== null && ca !== undefined && cl !== null && cl !== undefined) {
          interpretation = `${who(deal)} has ${fmt$(ca)} in current assets to cover ${fmt$(cl)} in near-term obligations (${fmtMultiple(value)}) — adequate working-capital runway without much excess.${seasonalNote}`;
        } else {
          interpretation = `${who(deal)} carries ${fmtMultiple(value)} in current assets per dollar of short-term debt — enough to meet near-term obligations but with limited cushion.${seasonalNote}`;
        }
      } else {
        interpretation = `${who(deal)}'s current assets cover only ${fmtMultiple(value)} of near-term obligations — below the 1.0x coverage floor. Meeting working-capital needs will require drawing on trade credit, revolver capacity, or owner capital.${seasonalNote}`;
      }
      return { assessment, interpretation, benchmarkNote: "Institutional floor: 1.0x. Healthy: ≥1.5x." };
    },
  },
  {
    metricId: "QUICK_RATIO",
    label: "Quick Ratio (Acid Test)",
    category: "Liquidity",
    unit: "ratio",
    interpret: ({ value, facts, deal }) => {
      const assessment = pickAssessment(value, 1.0, 0.5, "higher_is_better");
      const qa = facts.QUICK_ASSETS;
      const cl = facts.TOTAL_CURRENT_LIABILITIES;

      let interpretation: string;
      if (assessment === "Strong") {
        interpretation = qa !== null && qa !== undefined && cl !== null && cl !== undefined
          ? `${who(deal)} can cover ${fmt$(cl)} in near-term obligations from ${fmt$(qa)} in cash and receivables alone — no reliance on inventory conversion to meet short-term debts.`
          : `${who(deal)} covers ${fmtMultiple(value)} of near-term obligations without relying on inventory — strong immediate liquidity.`;
      } else if (assessment === "Adequate") {
        interpretation = `${who(deal)}'s cash and receivables cover ${fmtMultiple(value)} of current liabilities — adequate for routine operations, though full coverage requires some inventory liquidation.`;
      } else {
        interpretation = `${who(deal)} has only ${fmtMultiple(value)} of liquid assets per dollar of current liabilities — meeting short-term obligations depends materially on converting inventory to cash, elevating working-capital risk.`;
      }
      return { assessment, interpretation, benchmarkNote: "Institutional floor: 0.5x. Healthy: ≥1.0x." };
    },
  },
  {
    metricId: "WORKING_CAPITAL",
    label: "Working Capital",
    category: "Liquidity",
    unit: "currency",
    interpret: ({ value, deal }) => {
      if (value >= 0) {
        const seasonalNote = deal.seasonalityNote?.trim()
          ? ` Given the ${deal.seasonalityNote.toLowerCase()} concentration, this balance needs to fund the off-season expense base without revenue inflows.`
          : "";
        return {
          assessment: value > 0 ? "Strong" : "Adequate",
          interpretation: `${who(deal)} carries ${fmt$(value)} in working capital — operating funding cushion is positive.${seasonalNote}`,
          benchmarkNote: "Negative working capital indicates reliance on trade credit or short-term debt.",
        };
      }
      return {
        assessment: "Weak",
        interpretation: `${who(deal)} has negative working capital of ${fmt$(value)} — short-term liabilities exceed short-term assets, forcing reliance on trade credit, revolver draws, or owner capital to fund operations.`,
        benchmarkNote: "Negative working capital indicates reliance on trade credit or short-term debt.",
      };
    },
  },
  {
    metricId: "CASH_RATIO",
    label: "Cash Ratio",
    category: "Liquidity",
    unit: "ratio",
    interpret: ({ value, facts, deal }) => {
      const assessment = pickAssessment(value, 0.5, 0.2, "higher_is_better");
      const cash = facts.CASH_AND_EQUIVALENTS;
      const cl = facts.TOTAL_CURRENT_LIABILITIES;

      let interpretation: string;
      if (assessment === "Strong") {
        interpretation = cash !== null && cash !== undefined && cl !== null && cl !== undefined
          ? `${who(deal)} holds ${fmt$(cash)} in cash against ${fmt$(cl)} in current liabilities (${fmtMultiple(value)}) — a deep cash buffer absorbs near-term operating shocks without drawing on receivables or inventory.`
          : `${who(deal)} covers ${fmtMultiple(value)} of short-term liabilities with cash alone — deep cash reserve.`;
      } else if (assessment === "Adequate") {
        interpretation = `${who(deal)}'s cash covers ${fmtMultiple(value)} of current liabilities — enough to meet routine payables without fire-sale asset conversion, but not enough to absorb a prolonged revenue interruption.`;
      } else {
        interpretation = `${who(deal)} holds only ${fmtMultiple(value)} of current liabilities as cash — meeting payables depends on timely AR collection and inventory turnover. Any disruption to those flows creates immediate liquidity pressure.`;
      }
      return { assessment, interpretation, benchmarkNote: "Conservative banks look for ≥0.2x." };
    },
  },
  {
    metricId: "DAYS_CASH_ON_HAND",
    label: "Days Cash on Hand",
    category: "Liquidity",
    unit: "days",
    interpret: ({ value, deal }) => {
      const assessment = pickAssessment(value, 90, 30, "higher_is_better");
      const days = Math.round(value);

      let interpretation: string;
      if (assessment === "Strong") {
        interpretation = `${who(deal)} holds enough cash to fund ${days} days of operating expenses — ample runway to weather revenue disruption or fund near-term debt service without new cash inflows.`;
      } else if (assessment === "Adequate") {
        interpretation = `${who(deal)} has ${days} days of cash coverage for operating expenses — meets the 30-day SBA expectation but leaves little room for an extended revenue gap.`;
      } else {
        interpretation = `${who(deal)} holds only ${days} days of cash-based operating reserve — any extended revenue interruption would force immediate trade-credit or revolver reliance to meet payroll and fixed costs.`;
      }
      return { assessment, interpretation, benchmarkNote: "SBA lenders typically want ≥30 days; best-in-class ≥90 days." };
    },
  },

  // ── LEVERAGE ───────────────────────────────────────────────────────────
  {
    metricId: "DEBT_TO_EQUITY",
    label: "Debt / Worth",
    category: "Leverage",
    unit: "ratio",
    interpret: ({ value, facts, deal }) => {
      const assessment = pickAssessment(value, 1.5, 3.0, "lower_is_better");
      const netWorth = facts.NET_WORTH;
      const loanPct =
        netWorth !== null && netWorth !== undefined && deal.loanAmountDollars !== null && netWorth > 0
          ? (netWorth / deal.loanAmountDollars) * 100
          : null;
      const equityClause = loanPct !== null
        ? ` Net worth covers approximately ${loanPct.toFixed(0)}% of the proposed loan as a last-resort equity backstop.`
        : "";

      let interpretation: string;
      if (assessment === "Strong") {
        interpretation = `For every dollar of equity, ${whoLower(deal)} carries only ${fmtRatio(value)} in debt — conservative capital structure preserves substantial equity cushion against business downturns.${equityClause}`;
      } else if (assessment === "Adequate") {
        interpretation = `${who(deal)} carries ${fmtRatio(value)} in debt for every dollar of equity — leverage sits within policy limits but repayment relies more on cash flow than on equity reserves.${equityClause}`;
      } else {
        interpretation = `${who(deal)} carries ${fmtRatio(value)} in debt for every dollar of equity — leverage is stretched, and the ${deal.loanAmountDollars !== null ? fmt$(deal.loanAmountDollars) : "proposed"} note relies almost entirely on cash flow for repayment rather than equity liquidation.${equityClause}`;
      }
      return { assessment, interpretation, benchmarkNote: "Institutional ceiling: 3.0x. Healthy: ≤1.5x." };
    },
  },
  {
    metricId: "FIXED_ASSETS_NW",
    label: "Fixed Assets / Net Worth",
    category: "Leverage",
    unit: "ratio",
    interpret: ({ value, deal }) => {
      const assessment = pickAssessment(value, 0.75, 1.0, "lower_is_better");
      let interpretation: string;
      if (assessment === "Strong") {
        interpretation = `${who(deal)}'s fixed assets absorb ${fmtRatio(value)}x of net worth — capital is light enough to fund working-capital swings without liquidating long-lived assets.`;
      } else if (assessment === "Adequate") {
        interpretation = `${who(deal)}'s fixed assets tie up ${fmtRatio(value)}x of net worth — typical for capital-moderate businesses and leaves some equity free for operating flexibility.`;
      } else {
        interpretation = `${who(deal)}'s fixed assets absorb ${fmtRatio(value)}x of net worth — the bulk of equity is locked in long-lived assets, leaving minimal buffer for operating disruption.`;
      }
      return { assessment, interpretation, benchmarkNote: "Above 1.0x signals equity is tied up in long-lived assets." };
    },
  },
  {
    metricId: "DEBT_TO_EBITDA",
    label: "Debt / EBITDA Multiple",
    category: "Leverage",
    unit: "times",
    interpret: ({ value, facts, deal }) => {
      const assessment = pickAssessment(value, 3.0, 4.5, "lower_is_better");
      const totalDebt = facts.TOTAL_LIABILITIES;
      const paybackYears = value;

      let interpretation: string;
      if (assessment === "Strong") {
        interpretation = totalDebt !== null && totalDebt !== undefined
          ? `${who(deal)}'s total debt of ${fmt$(totalDebt)} is ${fmtMultiple(paybackYears)} EBITDA — all debt could theoretically be repaid in ~${Math.round(paybackYears)} years of current cash flow, well within investment-grade territory.`
          : `${who(deal)} carries ${fmtMultiple(paybackYears)} debt-to-EBITDA — total leverage is repayable in approximately ${Math.round(paybackYears)} years of current cash flow.`;
      } else if (assessment === "Adequate") {
        interpretation = totalDebt !== null && totalDebt !== undefined
          ? `${who(deal)}'s total debt of ${fmt$(totalDebt)} is ${fmtMultiple(paybackYears)} EBITDA — theoretical payback of ~${Math.round(paybackYears)} years is elevated but within middle-market tolerance.`
          : `${who(deal)} carries ${fmtMultiple(paybackYears)} debt-to-EBITDA — payback is manageable but refinance flexibility is narrower.`;
      } else {
        interpretation = `${who(deal)} carries ${fmtMultiple(paybackYears)} debt-to-EBITDA — above the 4.5x middle-market ceiling. Refinance risk is elevated and any EBITDA compression could force covenant breach or restructuring.`;
      }
      return { assessment, interpretation, benchmarkNote: "Middle-market ceiling: 4.5x. Bank-favorable: ≤3.0x." };
    },
  },
  {
    metricId: "CL_NW",
    label: "Current Liabilities / Net Worth",
    category: "Leverage",
    unit: "ratio",
    interpret: ({ value, deal }) => {
      const assessment = pickAssessment(value, 0.5, 1.0, "lower_is_better");
      let interpretation: string;
      if (assessment === "Strong") {
        interpretation = `${who(deal)}'s short-term liabilities are only ${fmtRatio(value)}x net worth — conservative short-term debt profile relative to retained equity.`;
      } else if (assessment === "Adequate") {
        interpretation = `${who(deal)}'s short-term liabilities at ${fmtRatio(value)}x net worth reflect a moderate near-term debt burden against the equity base.`;
      } else {
        interpretation = `${who(deal)}'s short-term liabilities exceed net worth (${fmtRatio(value)}x) — near-term obligations have outgrown the retained equity cushion, leaving limited liquidation coverage for payables and accrued liabilities.`;
      }
      return { assessment, interpretation, benchmarkNote: "Above 1.0x indicates short-term debt is outpacing retained equity." };
    },
  },
  {
    metricId: "TANGIBLE_NET_WORTH",
    label: "Tangible Net Worth",
    category: "Leverage",
    unit: "currency",
    interpret: ({ value, deal }) => {
      if (value >= 0) {
        const loanNote = deal.loanAmountDollars !== null && deal.loanAmountDollars > 0
          ? ` Covers ${((value / deal.loanAmountDollars) * 100).toFixed(0)}% of the ${fmt$(deal.loanAmountDollars)} loan as an asset-based backstop.`
          : "";
        return {
          assessment: "Adequate",
          interpretation: `${who(deal)} carries ${fmt$(value)} in tangible net worth after stripping intangibles — hard-asset equity is available as a liquidation-basis cushion.${loanNote}`,
          benchmarkNote: null,
        };
      }
      return {
        assessment: "Weak",
        interpretation: `${who(deal)} has negative tangible net worth of ${fmt$(value)} — intangibles exceed total equity. There is no asset-based equity cushion available for liquidation-basis recovery if repayment falters.`,
        benchmarkNote: "Lenders typically require positive tangible net worth for asset-based coverage.",
      };
    },
  },
  {
    metricId: "LIABILITIES_TO_TNW",
    label: "Total Liabilities / Tangible Net Worth",
    category: "Leverage",
    unit: "ratio",
    interpret: ({ value, deal }) => {
      const assessment = pickAssessment(value, 2.0, 4.0, "lower_is_better");
      let interpretation: string;
      if (assessment === "Strong") {
        interpretation = `${who(deal)}'s total liabilities are ${fmtRatio(value)}x tangible net worth — conservative leverage against the hard-asset equity base.`;
      } else if (assessment === "Adequate") {
        interpretation = `${who(deal)}'s total liabilities are ${fmtRatio(value)}x tangible net worth — leverage against hard-asset equity is manageable but nearing common covenant ceilings.`;
      } else {
        interpretation = `${who(deal)}'s total liabilities reach ${fmtRatio(value)}x tangible net worth — stretches the tangible equity base; most commercial banks cap this ratio at 3-4x.`;
      }
      return { assessment, interpretation, benchmarkNote: "Commercial banks commonly cap at 3–4x." };
    },
  },

  // ── COVERAGE ───────────────────────────────────────────────────────────
  {
    metricId: "DSCR",
    label: "Debt Service Coverage (DSCR)",
    category: "Coverage",
    unit: "times",
    interpret: ({ value, facts, deal }) => {
      const assessment = pickAssessment(value, 1.5, 1.25, "higher_is_better");
      const cfa = facts.CASH_FLOW_AVAILABLE;
      const ads = deal.annualDebtServiceDollars ?? facts.ANNUAL_DEBT_SERVICE ?? null;
      const cushion = cfa !== null && cfa !== undefined && ads !== null && ads !== undefined
        ? cfa - ads
        : null;
      const revenueCushionPct = revenueDeclineToBreachFloor(deal);
      const cushionClause = revenueCushionPct !== null
        ? ` Revenue (or EBITDA) can decline approximately ${revenueCushionPct.toFixed(0)}% before coverage falls below the 1.25x institutional floor.`
        : "";

      let interpretation: string;
      if (assessment === "Strong") {
        interpretation = (cfa !== null && cfa !== undefined && ads !== null && ads !== undefined && cushion !== null)
          ? `${who(deal)} generates ${fmt$(cfa)} in annual operating cash flow against ${fmt$(ads)} in proposed debt service, yielding ${fmtMultiple(value)} coverage — a ${fmt$(cushion)} cushion above annual payments.${cushionClause}`
          : `${who(deal)}'s operating cash flow covers debt service ${fmtMultiple(value)} — a deep repayment cushion above the 1.25x institutional minimum.${cushionClause}`;
      } else if (assessment === "Adequate") {
        interpretation = (cfa !== null && cfa !== undefined && ads !== null && ads !== undefined && cushion !== null)
          ? `${who(deal)} generates ${fmt$(cfa)} in operating cash flow against ${fmt$(ads)} in debt service, yielding ${fmtMultiple(value)} coverage — clears the 1.25x institutional floor with a ${fmt$(cushion)} cushion, but margin for error is limited.${cushionClause}`
          : `${who(deal)}'s operating cash flow covers debt service ${fmtMultiple(value)} — just above the 1.25x institutional floor with limited cushion for earnings stress.${cushionClause}`;
      } else {
        interpretation = (cfa !== null && cfa !== undefined && ads !== null && ads !== undefined)
          ? `${who(deal)} generates ${fmt$(cfa)} in operating cash flow against ${fmt$(ads)} in debt service — ${fmtMultiple(value)} coverage, below the 1.25x institutional minimum. Deal requires structural mitigants (guarantor support, reserves, or collateral coverage) to justify approval.`
          : `${who(deal)}'s operating cash flow covers debt service only ${fmtMultiple(value)} — below the 1.25x institutional minimum. Deal requires mitigants to proceed.`;
      }
      return { assessment, interpretation, benchmarkNote: "SBA/institutional minimum: 1.25x. Healthy: ≥1.50x." };
    },
  },
  {
    metricId: "DSCR_STRESSED_300BPS",
    label: "DSCR Stressed (+300 bps)",
    category: "Coverage",
    unit: "times",
    interpret: ({ value, deal }) => {
      const assessment = pickAssessment(value, 1.25, 1.0, "higher_is_better");
      let interpretation: string;
      if (assessment === "Strong") {
        interpretation = `Even under a +300 bps rate shock, ${whoLower(deal)} maintains ${fmtMultiple(value)} coverage — rate risk is well-absorbed, and a refinance at materially higher rates would not breach policy thresholds.`;
      } else if (assessment === "Adequate") {
        interpretation = `${who(deal)}'s DSCR compresses to ${fmtMultiple(value)} under a +300 bps shock — remains above 1.0x but offers limited cushion if rates rise further or earnings compress concurrently.`;
      } else {
        interpretation = `${who(deal)}'s DSCR falls to ${fmtMultiple(value)} under a +300 bps rate shock — below 1.0x coverage, meaning operating cash flow would no longer cover debt service at refinance. Material rate risk requires mitigation (rate cap, additional reserves, or shortened term).`;
      }
      return { assessment, interpretation, benchmarkNote: "Institutional stress floor: 1.0x at +300 bps." };
    },
  },
  {
    metricId: "INTEREST_COVERAGE",
    label: "Interest Coverage (TIE)",
    category: "Coverage",
    unit: "times",
    interpret: ({ value, facts, deal }) => {
      const assessment = pickAssessment(value, 5.0, 2.0, "higher_is_better");
      const interest = facts.INTEREST_EXPENSE;
      const ebit = facts.EBIT;

      let interpretation: string;
      if (assessment === "Strong") {
        interpretation = (ebit !== null && ebit !== undefined && interest !== null && interest !== undefined)
          ? `${who(deal)}'s ${fmt$(ebit)} in operating income covers ${fmt$(interest)} in interest ${fmtMultiple(value)} — deep cushion against earnings volatility.`
          : `${who(deal)}'s operating income covers interest ${fmtMultiple(value)} — ample headroom for earnings swings.`;
      } else if (assessment === "Adequate") {
        interpretation = `${who(deal)}'s operating income covers interest ${fmtMultiple(value)} — adequate cushion against moderate earnings stress but limited absorption of a material downturn.`;
      } else {
        interpretation = `${who(deal)}'s operating income covers interest only ${fmtMultiple(value)} — any earnings compression threatens interest coverage before principal service is considered.`;
      }
      return { assessment, interpretation, benchmarkNote: "Bank-favorable: ≥5x. Floor: 2x." };
    },
  },
  {
    metricId: "FIXED_CHARGE_COVERAGE",
    label: "Fixed Charge Coverage (FCCR)",
    category: "Coverage",
    unit: "times",
    interpret: ({ value, deal }) => {
      const assessment = pickAssessment(value, 1.5, 1.2, "higher_is_better");
      let interpretation: string;
      if (assessment === "Strong") {
        interpretation = `${who(deal)} covers all fixed charges (interest + rent) ${fmtMultiple(value)} — well above the 1.2x covenant threshold common to term loans in this market.`;
      } else if (assessment === "Adequate") {
        interpretation = `${who(deal)} covers fixed charges ${fmtMultiple(value)} — meets the 1.2x covenant threshold with limited headroom; a minor earnings miss would trigger a technical breach.`;
      } else {
        interpretation = `${who(deal)} covers fixed charges only ${fmtMultiple(value)} — below the 1.2x covenant standard. Elevated risk of covenant breach at first quarterly test.`;
      }
      return { assessment, interpretation, benchmarkNote: "Standard loan covenant: 1.2x." };
    },
  },
  {
    metricId: "GCF_DSCR",
    label: "Global DSCR",
    category: "Coverage",
    unit: "times",
    interpret: ({ value, deal }) => {
      const assessment = pickAssessment(value, 1.5, 1.25, "higher_is_better");
      let interpretation: string;
      if (assessment === "Strong") {
        interpretation = `Combining business cash flow with guarantor personal cash flow, ${whoLower(deal)}'s global coverage reaches ${fmtMultiple(value)} — a deep cushion, supporting the loan independently of any single income stream.`;
      } else if (assessment === "Adequate") {
        interpretation = `Global coverage (business + guarantor cash flow) reaches ${fmtMultiple(value)} — clears the 1.25x institutional floor, though the combined stream carries tighter margin than the business alone.`;
      } else {
        interpretation = `Even with guarantor support, ${whoLower(deal)}'s global cash flow covers debt service only ${fmtMultiple(value)} — below the 1.25x institutional minimum. Repayment capacity does not clear policy from any combined source.`;
      }
      return { assessment, interpretation, benchmarkNote: "Global coverage captures guarantor + business cash flow per SBA SOP 50 10." };
    },
  },

  // ── PROFITABILITY ──────────────────────────────────────────────────────
  {
    metricId: "GROSS_MARGIN",
    label: "Gross Margin",
    category: "Profitability",
    unit: "percent",
    applicableWhen: (f) => hasCogs(f),
    interpret: ({ value, facts, deal }) => {
      if (value < 0) {
        return {
          assessment: "Weak",
          interpretation: `${who(deal)} operates at a ${fmtPct(value)} negative gross margin — COGS exceeds revenue, meaning the business is not self-funding at the unit-economics level before fixed costs are even considered.`,
          benchmarkNote: "Benchmarks vary heavily by industry.",
        };
      }
      const assessment = pickAssessment(value, 0.4, 0.2, "higher_is_better");
      const revenue = facts.TOTAL_REVENUE ?? deal.revenueDollars ?? null;
      const grossProfit = facts.GROSS_PROFIT;
      const businessClause = businessTypeClause(deal);

      let interpretation: string;
      if (assessment === "Strong") {
        interpretation = revenue !== null && revenue !== undefined && grossProfit !== null && grossProfit !== undefined
          ? `${who(deal)}${businessClause} retains ${fmt$(grossProfit)} of every ${fmt$(revenue)} in revenue (${fmtPct(value)}) — strong pricing power and cost discipline generate substantial gross margin to absorb fixed costs and fund growth.`
          : `${who(deal)}'s gross margin of ${fmtPct(value)} reflects strong pricing power and cost control.`;
      } else if (assessment === "Adequate") {
        interpretation = `${who(deal)}${businessClause} retains ${fmtPct(value)} of revenue after direct costs — typical for the sector and adequate to absorb operating overhead.`;
      } else {
        interpretation = `${who(deal)}${businessClause} retains only ${fmtPct(value)} of revenue after direct costs — thin per-unit margin leaves limited room to absorb fixed costs or price pressure from suppliers.`;
      }
      return { assessment, interpretation, benchmarkNote: "Benchmarks vary heavily by industry." };
    },
  },
  {
    metricId: "OPERATING_PROFIT_MARGIN",
    label: "Operating Profit Margin",
    category: "Profitability",
    unit: "percent",
    interpret: ({ value, deal }) => {
      if (value < 0) {
        return {
          assessment: "Weak",
          interpretation: `${who(deal)} operates at a ${fmtPct(value)} negative operating margin — core operations are unprofitable before any debt service.`,
          benchmarkNote: null,
        };
      }
      const assessment = pickAssessment(value, 0.15, 0.05, "higher_is_better");
      let interpretation: string;
      if (assessment === "Strong") {
        interpretation = `${who(deal)}'s operating margin of ${fmtPct(value)} reflects strong operating discipline — substantial profit per revenue dollar after operating expenses.`;
      } else if (assessment === "Adequate") {
        interpretation = `${who(deal)}'s operating margin of ${fmtPct(value)} sits near sector norms — adequate profit after operating expenses with moderate cushion.`;
      } else {
        interpretation = `${who(deal)}'s operating margin of ${fmtPct(value)} leaves limited profit after operating expenses — material exposure to expense shocks.`;
      }
      return { assessment, interpretation, benchmarkNote: null };
    },
  },
  {
    metricId: "EBITDA_MARGIN",
    label: "EBITDA Margin",
    category: "Profitability",
    unit: "percent",
    interpret: ({ value, deal }) => {
      if (value < 0) {
        return {
          assessment: "Weak",
          interpretation: `${who(deal)} operates at a ${fmtPct(value)} negative EBITDA margin — cash-basis operating profit is negative before debt service is considered.`,
          benchmarkNote: null,
        };
      }
      const assessment = pickAssessment(value, 0.20, 0.10, "higher_is_better");
      const ebitda = deal.ebitdaDollars;
      const revenue = deal.revenueDollars;

      let interpretation: string;
      if (assessment === "Strong") {
        interpretation = ebitda !== null && revenue !== null
          ? `${who(deal)} converts ${fmt$(revenue)} in revenue into ${fmt$(ebitda)} of EBITDA (${fmtPct(value)}) — strong cash-basis profitability supports both debt service and reinvestment capacity.`
          : `${who(deal)}'s EBITDA margin of ${fmtPct(value)} reflects strong cash-basis profitability.`;
      } else if (assessment === "Adequate") {
        interpretation = `${who(deal)}'s EBITDA margin of ${fmtPct(value)} delivers solid cash-basis profitability — enough to comfortably service institutional debt at typical leverage levels.`;
      } else {
        interpretation = `${who(deal)}'s EBITDA margin of ${fmtPct(value)} leaves thin cash-basis profitability — limited room to absorb cost pressure before debt-service capacity is compromised.`;
      }
      return { assessment, interpretation, benchmarkNote: "Middle-market healthy: ≥20%. Institutional floor: ~10%." };
    },
  },
  {
    metricId: "NET_MARGIN",
    label: "Net Profit Margin",
    category: "Profitability",
    unit: "percent",
    interpret: ({ value, deal }) => {
      if (value < 0) {
        return {
          assessment: "Weak",
          interpretation: `${who(deal)} runs a ${fmtPct(value)} negative net margin — bottom-line losses after all expenses, including interest and taxes.`,
          benchmarkNote: null,
        };
      }
      const assessment = pickAssessment(value, 0.10, 0.03, "higher_is_better");
      let interpretation: string;
      if (assessment === "Strong") {
        interpretation = `${who(deal)} retains ${fmtPct(value)} of revenue as net profit after all expenses — strong bottom-line profitability supports retained-earnings growth.`;
      } else if (assessment === "Adequate") {
        interpretation = `${who(deal)} retains ${fmtPct(value)} of revenue as net profit — acceptable bottom-line for the sector, though sensitive to tax and interest-rate movements.`;
      } else {
        interpretation = `${who(deal)} retains only ${fmtPct(value)} of revenue as net profit — very thin bottom-line; any revenue shock or cost increase turns this to a loss.`;
      }
      return { assessment, interpretation, benchmarkNote: null };
    },
  },
  {
    metricId: "ROA",
    label: "Return on Assets (ROA)",
    category: "Profitability",
    unit: "percent",
    interpret: ({ value, deal }) => {
      if (value < 0) {
        return {
          assessment: "Weak",
          interpretation: `${who(deal)}'s ROA is negative (${fmtPct(value)}) — the asset base is generating losses rather than returns.`,
          benchmarkNote: null,
        };
      }
      const assessment = pickAssessment(value, 0.05, 0.01, "higher_is_better");
      let interpretation: string;
      if (assessment === "Strong") {
        interpretation = `${who(deal)} earns ${fmtPct(value)} on its asset base — strong productivity; every dollar of assets generates meaningful profit.`;
      } else if (assessment === "Adequate") {
        interpretation = `${who(deal)} earns ${fmtPct(value)} on assets — typical productivity for the sector.`;
      } else {
        interpretation = `${who(deal)} earns only ${fmtPct(value)} on assets — low productivity; substantial capital is tied up to produce modest profit.`;
      }
      return { assessment, interpretation, benchmarkNote: null };
    },
  },
  {
    metricId: "ROE",
    label: "Return on Equity (ROE)",
    category: "Profitability",
    unit: "percent",
    interpret: ({ value, deal }) => {
      if (value < 0) {
        return {
          assessment: "Weak",
          interpretation: `${who(deal)}'s ROE is negative (${fmtPct(value)}) — equity base is eroding rather than compounding.`,
          benchmarkNote: null,
        };
      }
      const assessment = pickAssessment(value, 0.15, 0.05, "higher_is_better");
      let interpretation: string;
      if (assessment === "Strong") {
        interpretation = `${who(deal)} generates ${fmtPct(value)} on equity — strong return compounds the equity base and supports organic growth without new capital.`;
      } else if (assessment === "Adequate") {
        interpretation = `${who(deal)} generates ${fmtPct(value)} on equity — adequate return to equity holders, modest compounding capacity.`;
      } else {
        interpretation = `${who(deal)} generates only ${fmtPct(value)} on equity — low return means slow equity build-up and heavy reliance on debt for growth capital.`;
      }
      return { assessment, interpretation, benchmarkNote: null };
    },
  },

  // ── ACTIVITY / EFFICIENCY ──────────────────────────────────────────────
  {
    metricId: "AR_DAYS",
    label: "AR Days (DSO)",
    category: "Activity",
    unit: "days",
    interpret: ({ value, deal }) => {
      const assessment = pickAssessment(value, 30, 60, "lower_is_better");
      const days = Math.round(value);
      let interpretation: string;
      if (assessment === "Strong") {
        interpretation = `${who(deal)} collects in ${days} days on average — tight receivables discipline minimizes working-capital tied up in AR.`;
      } else if (assessment === "Adequate") {
        interpretation = `${who(deal)} collects in ${days} days — typical B2B cadence; working-capital needs remain in a normal range.`;
      } else {
        interpretation = `${who(deal)} collects in ${days} days on average — slow collections inflate working-capital needs and create concentration risk in the AR base; a customer failure can delay cash materially.`;
      }
      return { assessment, interpretation, benchmarkNote: "B2B sector typical: 30–60 days." };
    },
  },
  {
    metricId: "INVENTORY_TURNOVER",
    label: "Inventory Turnover",
    category: "Activity",
    unit: "times",
    applicableWhen: (f) => hasInventory(f) && hasCogs(f),
    interpret: ({ value, deal }) => {
      const assessment = pickAssessment(value, 8, 4, "higher_is_better");
      let interpretation: string;
      if (assessment === "Strong") {
        interpretation = `${who(deal)} turns inventory ${fmtMultiple(value)} per year — efficient stock management minimizes holding costs and obsolescence exposure.`;
      } else if (assessment === "Adequate") {
        interpretation = `${who(deal)} turns inventory ${fmtMultiple(value)} per year — typical pace for the sector.`;
      } else {
        interpretation = `${who(deal)} turns inventory only ${fmtMultiple(value)} per year — slow-moving stock ties up working capital and raises the risk of markdowns or write-offs.`;
      }
      return { assessment, interpretation, benchmarkNote: null };
    },
  },
  {
    metricId: "DIO",
    label: "Days Inventory Outstanding (DIO)",
    category: "Activity",
    unit: "days",
    applicableWhen: (f) => hasInventory(f) && hasCogs(f),
    interpret: ({ value, deal }) => {
      const assessment = pickAssessment(value, 45, 90, "lower_is_better");
      const days = Math.round(value);
      let interpretation: string;
      if (assessment === "Strong") {
        interpretation = `${who(deal)} holds ${days} days of inventory on hand — tight stock control minimizes working-capital absorption.`;
      } else if (assessment === "Adequate") {
        interpretation = `${who(deal)} holds ${days} days of inventory on hand — typical for the sector.`;
      } else {
        interpretation = `${who(deal)} holds ${days} days of inventory on hand — high days-on-hand ties up working capital and exposes the business to obsolescence or price markdowns.`;
      }
      return { assessment, interpretation, benchmarkNote: null };
    },
  },
  {
    metricId: "DPO",
    label: "Days Payable Outstanding (DPO)",
    category: "Activity",
    unit: "days",
    applicableWhen: (f) => hasCogs(f),
    interpret: ({ value, deal }) => {
      const days = Math.round(value);
      if (value > 90) {
        return {
          assessment: "Weak",
          interpretation: `${who(deal)} pays suppliers in ${days} days on average — stretched terms may indicate supplier friction, cash strain, or pending payable disputes.`,
          benchmarkNote: "B2B sector typical: 30–60 days.",
        };
      }
      if (value >= 30) {
        return {
          assessment: "Adequate",
          interpretation: `${who(deal)} pays suppliers in ${days} days — in line with sector norms; no sign of trade-credit stretch.`,
          benchmarkNote: "B2B sector typical: 30–60 days.",
        };
      }
      return {
        assessment: "Adequate",
        interpretation: `${who(deal)} pays suppliers within ${days} days — prompt payment disciplines trade-credit costs but may forego available free financing from standard terms.`,
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
    interpret: ({ value, deal }) => {
      const assessment = pickAssessment(value, 30, 60, "lower_is_better");
      const days = Math.round(value);
      let interpretation: string;
      if (assessment === "Strong") {
        interpretation = `${who(deal)}'s cash conversion cycle is ${days} days — highly efficient working-capital cycle; each dollar of cash turns quickly back into revenue.`;
      } else if (assessment === "Adequate") {
        interpretation = `${who(deal)}'s cash conversion cycle is ${days} days — typical working-capital cycle for the sector.`;
      } else {
        interpretation = `${who(deal)}'s cash conversion cycle is ${days} days — extended cash-tied-up cycle; growth in revenue requires proportional investment in working capital before collection.`;
      }
      return { assessment, interpretation, benchmarkNote: "Lower is better. Negative CCC (Amazon-style) is best-in-class." };
    },
  },
];

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

type BuildArgs = {
  dealId: string;
  bankId: string;
  dealContext?: DealContext;
};

/**
 * Phase 88+91 — build the full institutional ratio suite for the credit memo.
 *
 * Reads the latest-period facts from deal_financial_facts, pre-computes
 * helper metrics, then evaluates each ratio in the canonical suite.
 * Phase 91: interpret() functions now receive a DealContext so the output
 * prose names the borrower, translates ratios into dollar terms, and ties
 * back to repayment capacity. Falls back to generic phrasing when deal
 * context fields are absent.
 */
export async function buildRatioAnalysisSuite(
  args: BuildArgs,
): Promise<RatioAnalysisRow[]> {
  const sb = supabaseAdmin();
  const deal: DealContext = args.dealContext ?? EMPTY_DEAL_CONTEXT;

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

    if (value === null) continue;

    let interp: InterpretResult;
    try {
      interp = spec.interpret({ value, facts, deal });
    } catch (err) {
      // Defensive: if an interpretation throws (e.g. on edge-case input),
      // fall back to a minimal deterministic sentence so the row still renders.
      console.warn(`[buildRatioAnalysisSuite] interpret failed for ${spec.metricId}:`, err);
      interp = {
        assessment: pickAssessment(value, 0, 0, "higher_is_better"),
        interpretation: `${spec.label}: ${value.toFixed(2)}`,
        benchmarkNote: null,
      };
    }

    rows.push({
      metric: spec.label,
      category: spec.category,
      value,
      industry_avg: null,
      industry_source: null,
      unit: spec.unit,
      period_label: periodLabel,
      assessment: interp.assessment,
      interpretation: interp.interpretation,
      benchmark_note: interp.benchmarkNote,
    });
  }

  return rows;
}

export { inferBusinessModel };
