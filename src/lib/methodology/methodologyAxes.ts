/**
 * SPEC-B4 — Methodology Axes Registry.
 *
 * Single source of truth for all methodology axes and their variants.
 * Pure constant — no runtime, no DB.
 */

import type { MethodologyAxis, MethodologyAxisId } from "./types";

export const METHODOLOGY_AXES: Record<MethodologyAxisId, MethodologyAxis> = {
  ncads_source: {
    id: "ncads_source",
    label: "NCADS Source",
    description: "Which income line drives Net Cash After Debt Service.",
    variants: [
      {
        id: "standard",
        label: "Standard (EBITDA → OBI → NI)",
        description: "EBITDA preferred, then OBI, then Net Income as fallback.",
        rationale: "Preferred when latest-period EBITDA is available and reflects normalized operations.",
        conservatismRank: 30,
      },
      {
        id: "conservative",
        label: "Conservative (Net Income only)",
        description: "Net Income only — no operational add-backs unless separately documented.",
        rationale: "Appropriate when add-backs are large relative to net income and lack documentation.",
        conservatismRank: 80,
      },
      {
        id: "tax_return_basis",
        label: "Tax Return Basis (OBI only)",
        description: "Ordinary Business Income from the tax return — what the IRS sees.",
        rationale: "IRS-reported income removes management discretion from revenue/expense recognition.",
        conservatismRank: 60,
      },
    ],
    defaultVariant: "standard",
    affectedFactKeys: ["CASH_FLOW_AVAILABLE", "DSCR", "EXCESS_CASH_FLOW"],
  },

  ebitda_addback_stack: {
    id: "ebitda_addback_stack",
    label: "EBITDA Add-Back Stack",
    description: "Which items are added back to OBI to compute EBITDA.",
    variants: [
      {
        id: "standard",
        label: "Standard (all extracted)",
        description: "All extracted add-backs: D&A, interest, §179, bonus depreciation, non-recurring.",
        rationale: "Full add-back stack captures all non-cash and non-recurring items.",
        conservatismRank: 20,
      },
      {
        id: "conservative",
        label: "Conservative (D&A + interest only)",
        description: "Only depreciation/amortization and interest. No §179, no bonus depreciation, no non-recurring without documentation.",
        rationale: "§179 and bonus depreciation inflate EBITDA beyond sustainable cash flow. Conservative approach limits add-backs to items with clear cash-flow relevance.",
        conservatismRank: 70,
      },
      {
        id: "aggressive",
        label: "Aggressive (standard + officer comp normalization)",
        description: "Standard stack plus officer compensation normalization for closely-held entities.",
        rationale: "Full normalization maximizes EBITDA for entities where owner comp is discretionary.",
        conservatismRank: 10,
      },
    ],
    defaultVariant: "conservative",
    affectedFactKeys: ["EBITDA", "CASH_FLOW_AVAILABLE", "DSCR"],
  },

  officer_comp: {
    id: "officer_comp",
    label: "Officer Compensation",
    description: "How officer compensation is analyzed relative to market rates.",
    variants: [
      {
        id: "standard",
        label: "Standard (10% baseline, 40% threshold)",
        description: "Market rate estimate at 10% of revenue; flag excess above 40%.",
        rationale: "Industry-standard thresholds for closely-held entity officer comp analysis.",
        conservatismRank: 40,
      },
      {
        id: "conservative",
        label: "Conservative (15% baseline)",
        description: "Market rate estimate at 15% of revenue — lower add-back than standard.",
        rationale: "Higher market rate baseline reduces the excess comp add-back, producing a more conservative EBITDA.",
        conservatismRank: 70,
      },
      {
        id: "no_normalization",
        label: "No Normalization",
        description: "Treat reported officer comp as final — no add-back.",
        rationale: "Owner comp is what it is. No adjustment ensures EBITDA reflects actual cash flows.",
        conservatismRank: 90,
      },
    ],
    defaultVariant: "standard",
    affectedFactKeys: ["EBITDA", "CASH_FLOW_AVAILABLE", "DSCR"],
  },

  affiliate_ownership: {
    id: "affiliate_ownership",
    label: "Affiliate Ownership",
    description: "How unknown or minority ownership percentages are handled in GCF.",
    variants: [
      {
        id: "standard",
        label: "Standard (assume 100% if unknown)",
        description: "Unknown ownership defaults to 100%. No floor.",
        rationale: "Maximizes entity cash flow contribution when ownership is undocumented.",
        conservatismRank: 10,
      },
      {
        id: "conservative",
        label: "Conservative (assume 0% if unknown, 50% floor)",
        description: "Unknown ownership defaults to 0% (exclude). Below 50% ownership, exclude entirely.",
        rationale: "Below 50% ownership, the borrower likely lacks control over distributions. Unknown ownership should not inflate global cash flow.",
        conservatismRank: 80,
      },
      {
        id: "documented_only",
        label: "Documented Only",
        description: "Require explicit K-1 / operating agreement; otherwise exclude from GCF.",
        rationale: "Only documented ownership counts. Prevents GCF inflation from assumed ownership.",
        conservatismRank: 95,
      },
    ],
    defaultVariant: "conservative",
    affectedFactKeys: ["GCF_GLOBAL_CASH_FLOW", "GCF_DSCR", "GLOBAL_CASH_FLOW"],
  },

  living_expense: {
    id: "living_expense",
    label: "Living Expense",
    description: "How personal obligations are treated in global cash flow.",
    variants: [
      {
        id: "standard",
        label: "Standard (stated obligations)",
        description: "Use stated personal obligations as-is.",
        rationale: "Takes the borrower's reported personal obligations at face value.",
        conservatismRank: 20,
      },
      {
        id: "sba_sop_minimum",
        label: "SBA SOP Minimum",
        description: "Apply IRS National Standards floor by household size.",
        rationale: "SBA SOP 50 10 7 requires minimum living expense deduction. Prevents understated obligations from inflating GCF.",
        conservatismRank: 70,
      },
      {
        id: "buffered",
        label: "Buffered (stated × 1.10x)",
        description: "Stated obligations plus 10% buffer for undisclosed items.",
        rationale: "Borrowers routinely understate personal obligations. 10% buffer provides margin of safety.",
        conservatismRank: 60,
      },
    ],
    defaultVariant: "sba_sop_minimum",
    affectedFactKeys: ["GCF_GLOBAL_CASH_FLOW", "GCF_DSCR"],
  },
};

/** All axis IDs in registry order. */
export const ALL_METHODOLOGY_AXIS_IDS: MethodologyAxisId[] = Object.keys(
  METHODOLOGY_AXES,
) as MethodologyAxisId[];
