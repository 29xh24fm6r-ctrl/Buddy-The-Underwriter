/**
 * SPEC-QOE-OWNERBENEFIT-ACTIVATION-1 — interim "fast partial" (pre-Phase-0).
 *
 * Activates ONLY the QoE materiality check (`other income/expense > 5% of
 * revenue → documentation-required flag`) against the EXISTING rolled-up
 * canonical buckets (`OTHER_INCOME` / `OTHER_DEDUCTIONS`). It ships now and
 * surfaces material non-recurring buckets for analyst review, but deliberately
 * CANNOT auto-classify PPP / EIDL / ERC — the descriptive labels those patterns
 * need are not captured today (Branch B, §0). Granular capture is Phase 0.
 *
 * Hard boundary: this is an ANALYST FLAG. It does NOT feed the cash-flow
 * waterfall arithmetic and does NOT change the production NCADS baseline — the
 * baseline change is the data-gated Phase 1 with real per-item detection.
 *
 * Reuses the institutional engine verbatim (`computeQualityOfEarnings`) — no new
 * QoE logic. Pure module — no DB, no server imports.
 */

import {
  computeQualityOfEarnings,
  type QoEInput,
  type QoEAdjustment,
  type QoEConfidence,
} from "@/lib/spreads/qoeEngine";

type FactMap = Record<string, number | null>;

// Rolled-up canonical buckets that hold collapsed non-recurring detail today.
// First present (in priority order) wins — avoids double-counting the same bucket
// sourced from multiple documents.
const OTHER_INCOME_KEYS = ["OTHER_INCOME", "SK_OTHER_INCOME", "OTHER_INCOME_SCH1"];
const OTHER_EXPENSE_KEYS = ["OTHER_DEDUCTIONS", "OTHER_EXPENSES", "OTHER_OPERATING_EXPENSE"];
const REVENUE_KEYS = ["GROSS_RECEIPTS", "TOTAL_REVENUE", "TOTAL_INCOME"];

// The qoeEngine materiality path keys off /other\s+(income|expense)/i, so the
// synthesized labels must be exactly "Other Income" / "Other Expense" (NOT
// "Other Operating Expense", which would not match the engine's regex).
const OTHER_INCOME_LABEL = "Other Income";
const OTHER_EXPENSE_LABEL = "Other Expense";
const SOURCE = "Canonical rolled-up fact (interim QoE materiality flag)";

export type QoEMaterialityFlag = {
  lineItem: string;
  amount: number;
  pctOfRevenue: number | null;
  classification: QoEAdjustment["classification"];
  documentationRequired: boolean;
  source: string;
  note: string;
};

export type QoEMaterialityResult = {
  flags: QoEMaterialityFlag[];
  confidence: QoEConfidence;
  /** Raw engine adjustments behind the flags (provenance / audit trail). */
  adjustments: QoEAdjustment[];
};

function firstPresent(facts: FactMap, keys: string[]): number | null {
  for (const k of keys) {
    const v = facts[k];
    if (v !== null && v !== undefined) return Number(v);
  }
  return null;
}

/**
 * Build a QoEInput from the rolled-up "other income / expense" buckets. Only the
 * materiality path can fire on these generic labels — the specific PPP/EIDL/ERC
 * patterns cannot match (that is the grain limitation this interim documents).
 */
export function buildMaterialityQoEInput(args: {
  otherIncome: number | null;
  otherExpense: number | null;
  revenue: number | null;
}): QoEInput {
  const incomeItems =
    args.otherIncome !== null && args.otherIncome !== 0
      ? [{ label: OTHER_INCOME_LABEL, amount: args.otherIncome, source: SOURCE }]
      : [];
  const expenseItems =
    args.otherExpense !== null && args.otherExpense !== 0
      ? [{ label: OTHER_EXPENSE_LABEL, amount: args.otherExpense, source: SOURCE }]
      : [];
  return {
    // reportedEbitda is irrelevant to the materiality path and is NOT used to
    // change any baseline here — the flag is advisory only.
    reportedEbitda: 0,
    incomeItems,
    expenseItems,
    revenue: args.revenue,
    priorYearBadDebt: null,
    priorYearLegalFees: null,
  };
}

/** Run the engine and surface only the documentation-required materiality flags. */
export function computeQoEMaterialityFlags(input: QoEInput): QoEMaterialityResult {
  const report = computeQualityOfEarnings(input);
  const revenue = input.revenue;

  const flags: QoEMaterialityFlag[] = report.adjustments
    // The >5%-of-revenue materiality path emits documentation-required,
    // non-auto-approved adjustments. Specific (auto-approved) pattern matches
    // cannot occur on rolled-up labels, but filter defensively regardless.
    .filter((a) => a.documentationRequired && !a.autoApproved)
    .map((a) => ({
      lineItem: a.lineItem,
      amount: a.amount,
      pctOfRevenue: revenue !== null && revenue > 0 ? (a.amount / revenue) * 100 : null,
      classification: a.classification,
      documentationRequired: a.documentationRequired,
      source: a.source,
      note:
        `Material ${a.lineItem} ($${Math.round(a.amount).toLocaleString("en-US")}` +
        (revenue !== null && revenue > 0
          ? `, ${((a.amount / revenue) * 100).toFixed(1)}% of revenue`
          : "") +
        ") exceeds the 5% materiality threshold — analyst documentation required to " +
        "classify (e.g. PPP/EIDL/ERC, gain on sale). Granular line-item capture " +
        "(Phase 0) is required for automatic classification.",
    }));

  return { flags, confidence: report.confidence, adjustments: report.adjustments };
}

/** Convenience: resolve the rolled-up buckets from a canonical fact map. */
export function computeQoEMaterialityFlagsFromFacts(facts: FactMap): QoEMaterialityResult {
  return computeQoEMaterialityFlags(
    buildMaterialityQoEInput({
      otherIncome: firstPresent(facts, OTHER_INCOME_KEYS),
      otherExpense: firstPresent(facts, OTHER_EXPENSE_KEYS),
      revenue: firstPresent(facts, REVENUE_KEYS),
    }),
  );
}
