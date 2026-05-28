/**
 * SPEC-TAX-RETURN-OTHER-DEDUCTIONS-STATEMENT-SPREADING-4
 *
 * Builds an earnings normalization narrative for the credit memo from
 * extracted Other Deductions detail (OD_DETAIL_* facts).
 *
 * Pure function — reads from pre-loaded facts, no DB calls.
 *
 * Rules:
 * - Only include addback language for banker-marked addback/non-recurring items
 * - Unmarked high-risk items are disclosed, not automatically adjusted
 * - Missing detail → fallback to aggregate-only description
 * - Reconciliation mismatch noted but does not block narrative
 */

import {
  OD_HIGH_RISK_CATEGORIES,
  OD_POTENTIAL_ADDBACK_CATEGORIES,
  OD_SUMMARY_KEYS,
  type OdCategory,
} from "@/lib/financialSpreads/extractors/otherDeductionsDetailKeys";

export type OdFactRow = {
  fact_key: string;
  fact_value_num: number | null;
  fact_period_end: string | null;
  resolution_status: string | null;
};

export type OdNormalizationResult = {
  narrative: string;
  addbackTotal: number;
  nonRecurringTotal: number;
  hasDetail: boolean;
  year: number | null;
};

function fmtDollars(n: number): string {
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function fmtPct(n: number): string {
  return (n * 100).toFixed(1) + "%";
}

export function buildOdNormalizationNarrative(
  odFacts: OdFactRow[],
  aggregateOtherDeductions: number | null,
  grossReceipts: number | null,
  year: number | null,
): OdNormalizationResult {
  if (odFacts.length === 0 || aggregateOtherDeductions == null) {
    // No detail available — return aggregate-only fallback
    const fallback = aggregateOtherDeductions != null && grossReceipts != null && grossReceipts > 0
      ? `Other deductions of ${fmtDollars(aggregateOtherDeductions)} (${fmtPct(aggregateOtherDeductions / grossReceipts)} of gross receipts) are reflected in the tax return. Line-level detail was not available for review.`
      : "Other deductions detail was not available for this period.";

    return { narrative: fallback, addbackTotal: 0, nonRecurringTotal: 0, hasDetail: false, year };
  }

  const lines: string[] = [];
  const yr = year ?? "the reviewed period";

  // Parse facts into category map
  const categories = new Map<string, { amount: number; status: string | null }>();
  let detailTotal: number | null = null;
  let reconciled: boolean | null = null;

  for (const f of odFacts) {
    const key = f.fact_key;
    if (key === OD_SUMMARY_KEYS.DETAIL_TOTAL) {
      detailTotal = f.fact_value_num;
    } else if (key === OD_SUMMARY_KEYS.RECONCILED) {
      reconciled = f.fact_value_num === 1;
    } else if (
      key !== OD_SUMMARY_KEYS.UNCATEGORIZED_TOTAL &&
      key !== OD_SUMMARY_KEYS.RELATED_PARTY_TOTAL &&
      key !== OD_SUMMARY_KEYS.POTENTIAL_ADDBACK_TOTAL &&
      key !== OD_SUMMARY_KEYS.NON_RECURRING_TOTAL &&
      key.startsWith("OD_DETAIL_")
    ) {
      const cat = key.replace("OD_DETAIL_", "") as OdCategory;
      if (f.fact_value_num != null && f.fact_value_num > 0) {
        categories.set(cat, { amount: f.fact_value_num, status: f.resolution_status });
      }
    }
  }

  if (categories.size === 0) {
    return {
      narrative: `Other deductions of ${fmtDollars(aggregateOtherDeductions)} are reflected in the ${yr} tax return. Extracted detail contained no material individual categories.`,
      addbackTotal: 0,
      nonRecurringTotal: 0,
      hasDetail: true,
      year,
    };
  }

  // Opening
  const ratio = grossReceipts != null && grossReceipts > 0
    ? ` (${fmtPct(aggregateOtherDeductions / grossReceipts)} of gross receipts)`
    : "";
  lines.push(`**Other Deductions Analysis — ${yr}**`);
  lines.push("");
  lines.push(`The ${yr} business tax return includes other deductions of ${fmtDollars(aggregateOtherDeductions)}${ratio}. Line-item detail was extracted and reviewed.`);

  // Reconciliation
  if (detailTotal != null) {
    const variance = Math.abs(aggregateOtherDeductions - detailTotal);
    if (reconciled) {
      lines.push(`Detail total of ${fmtDollars(detailTotal)} reconciles to the return aggregate within rounding tolerance.`);
    } else if (variance > 1) {
      lines.push(`**Note:** Detail total of ${fmtDollars(detailTotal)} differs from return aggregate by ${fmtDollars(variance)}. This variance should be considered when interpreting the line-level breakdown.`);
    }
  }
  lines.push("");

  // Material categories (sorted by amount)
  const sorted = Array.from(categories.entries())
    .sort(([, a], [, b]) => b.amount - a.amount);

  const materialLines: string[] = [];
  let addbackTotal = 0;
  let nonRecurringTotal = 0;

  for (const [cat, { amount, status }] of sorted) {
    const label = cat.replace(/_/g, " ").toLowerCase();
    const isHighRisk = OD_HIGH_RISK_CATEGORIES.has(cat as OdCategory);
    const isAddback = status === "banker_addback";
    const isNonRecurring = status === "banker_non_recurring";

    let annotation = "";
    if (isAddback) {
      annotation = " — **marked for addback**";
      addbackTotal += amount;
    } else if (isNonRecurring) {
      annotation = " — **non-recurring, excluded from normalized earnings**";
      nonRecurringTotal += amount;
    } else if (isHighRisk && status !== "banker_reviewed") {
      annotation = " *(requires review)*";
    } else if (status === "banker_reviewed") {
      annotation = " *(reviewed — no adjustment)*";
    }

    materialLines.push(`- ${label}: ${fmtDollars(amount)}${annotation}`);
  }

  if (materialLines.length > 0) {
    lines.push("**Material categories:**");
    lines.push(...materialLines);
    lines.push("");
  }

  // Normalization summary
  if (addbackTotal > 0 || nonRecurringTotal > 0) {
    const adjustments: string[] = [];
    if (addbackTotal > 0) adjustments.push(`${fmtDollars(addbackTotal)} in banker-approved addbacks`);
    if (nonRecurringTotal > 0) adjustments.push(`${fmtDollars(nonRecurringTotal)} in non-recurring items`);
    lines.push(`**Earnings normalization:** ${adjustments.join(" and ")} identified within other deductions. These adjustments are reflected in the normalized cash flow analysis.`);
  } else {
    lines.push("No addback or non-recurring adjustments were identified by the reviewing banker. Other deductions are treated as recurring operating expenses for underwriting purposes.");
  }

  return {
    narrative: lines.join("\n"),
    addbackTotal,
    nonRecurringTotal,
    hasDetail: true,
    year,
  };
}
