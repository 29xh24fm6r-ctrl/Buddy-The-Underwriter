/**
 * Credit Metrics — Debt Service Harmonization
 *
 * Extracts debt service from FinancialModel periods.
 * No annualization, no policy logic, no stress testing.
 *
 * PHASE 4A: Analytics foundation only.
 * - `existing` = income.interest (debt service from income statement)
 * - `proposed` = undefined (requires loan assumptions, not available in FinancialModel alone)
 */

import type { FinancialModel } from "@/lib/modelEngine/types";
import type { DebtServiceResult } from "./types";

/**
 * Compute debt service for a specific period.
 *
 * Pure function — deterministic, no side effects.
 */
export function computeDebtServiceForPeriod(
  model: FinancialModel,
  periodId: string,
): DebtServiceResult {
  const period = model.periods.find((p) => p.periodId === periodId);

  if (!period) {
    return {
      totalDebtService: undefined,
      breakdown: { proposed: undefined, existing: undefined },
      diagnostics: {
        source: "income.interest",
        missingComponents: [`Period ${periodId} not found in model`],
      },
    };
  }

  const interest = period.income.interest;

  if (interest === undefined) {
    return {
      totalDebtService: undefined,
      breakdown: { proposed: undefined, existing: undefined },
      diagnostics: {
        source: "income.interest",
        missingComponents: ["income.interest (DEBT_SERVICE fact)"],
      },
    };
  }

  return {
    totalDebtService: interest,
    breakdown: {
      proposed: undefined, // Phase 4A: not available without loan assumptions
      existing: interest,
    },
    diagnostics: {
      source: "income.interest",
    },
  };
}
