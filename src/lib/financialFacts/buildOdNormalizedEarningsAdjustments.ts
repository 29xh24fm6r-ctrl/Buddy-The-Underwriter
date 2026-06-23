/**
 * SPEC-TAX-RETURN-OTHER-DEDUCTIONS-STATEMENT-SPREADING-5
 *
 * Pure function: computes normalized earnings adjustments from banker-marked
 * Other Deductions detail facts.
 *
 * Only includes items where resolution_status is:
 *   - "banker_addback" → added back to normalized earnings
 *   - "banker_non_recurring" → excluded from normalized earnings (same effect)
 *
 * Does NOT include:
 *   - banker_reviewed (no adjustment)
 *   - unmarked / null status (disclosure only)
 *   - any category without explicit banker action
 *
 * This function is consumed by both:
 *   - runCashFlowAggregator (to adjust NCADS)
 *   - buildOdNormalizationNarrative (for memo consistency)
 */

export type OdEarningsAdjustment = {
  category: string;
  label: string;
  amount: number;
  adjustmentType: "addback" | "non_recurring";
  factId?: string;
  year: number;
};

export type OdAdjustmentResult = {
  adjustments: OdEarningsAdjustment[];
  addbackTotal: number;
  nonRecurringTotal: number;
  totalAdjustment: number;
};

export type OdFactInput = {
  id?: string;
  fact_key: string;
  fact_value_num: number | null;
  fact_period_end: string | null;
  resolution_status: string | null;
};

/**
 * Build earnings adjustments from banker-marked OD detail facts.
 * Pure — no DB access. Call with pre-loaded facts for a specific year.
 */
export function buildOdNormalizedEarningsAdjustments(
  odFacts: OdFactInput[],
  year: number,
): OdAdjustmentResult {
  const adjustments: OdEarningsAdjustment[] = [];
  let addbackTotal = 0;
  let nonRecurringTotal = 0;

  for (const fact of odFacts) {
    // Only process individual category lines (not summary keys)
    if (!fact.fact_key.startsWith("OD_DETAIL_")) continue;
    if (fact.fact_key === "OD_DETAIL_TOTAL") continue;
    if (fact.fact_key === "OD_DETAIL_UNCATEGORIZED_TOTAL") continue;
    if (fact.fact_key === "OD_DETAIL_RELATED_PARTY_TOTAL") continue;
    if (fact.fact_key === "OD_DETAIL_POTENTIAL_ADDBACK_TOTAL") continue;
    if (fact.fact_key === "OD_DETAIL_NON_RECURRING_TOTAL") continue;
    if (fact.fact_key === "OD_DETAIL_RECONCILED") continue;

    const amount = fact.fact_value_num;
    if (amount == null || amount <= 0) continue;

    // Filter by year
    if (fact.fact_period_end) {
      const factYear = new Date(fact.fact_period_end).getFullYear();
      if (factYear !== year) continue;
    }

    const category = fact.fact_key.replace("OD_DETAIL_", "");
    const label = `Other Deductions - ${category.replace(/_/g, " ").toLowerCase()}`;

    if (fact.resolution_status === "banker_addback") {
      adjustments.push({
        category,
        label,
        amount,
        adjustmentType: "addback",
        factId: fact.id,
        year,
      });
      addbackTotal += amount;
    } else if (fact.resolution_status === "banker_non_recurring") {
      adjustments.push({
        category,
        label,
        amount,
        adjustmentType: "non_recurring",
        factId: fact.id,
        year,
      });
      nonRecurringTotal += amount;
    }
    // banker_reviewed, null, or any other status → no adjustment (disclosure only)
  }

  return {
    adjustments,
    addbackTotal,
    nonRecurringTotal,
    totalAdjustment: addbackTotal + nonRecurringTotal,
  };
}
