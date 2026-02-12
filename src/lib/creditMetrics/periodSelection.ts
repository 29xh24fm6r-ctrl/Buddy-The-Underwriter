/**
 * Credit Metrics — Period Selection Engine
 *
 * Deterministic period selection from FinancialModel.periods.
 * Never infers, fabricates, or transforms periods.
 *
 * PHASE 4A: Analytics foundation only.
 */

import type { FinancialModel, FinancialPeriod } from "@/lib/modelEngine/types";
import type { PeriodSelectionOpts, SelectedPeriodResult } from "./types";

function buildResult(
  period: FinancialPeriod,
  reason: string,
  candidatePeriods: string[],
  excludedPeriods: string[],
): SelectedPeriodResult {
  return {
    periodId: period.periodId,
    periodEnd: period.periodEnd,
    type: period.type,
    diagnostics: { reason, candidatePeriods, excludedPeriods },
  };
}

/**
 * Select a single analysis period from a FinancialModel.
 *
 * Pure function — deterministic, no side effects.
 * Returns undefined when no suitable period is found.
 */
export function selectAnalysisPeriod(
  model: FinancialModel,
  opts: PeriodSelectionOpts,
): SelectedPeriodResult | undefined {
  const allIds = model.periods.map((p) => p.periodId);

  switch (opts.strategy) {
    case "LATEST_FY": {
      const candidates = model.periods.filter((p) => p.type === "FYE");
      const excluded = model.periods.filter((p) => p.type !== "FYE").map((p) => p.periodId);
      if (candidates.length === 0) return undefined;
      const sorted = [...candidates].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
      return buildResult(
        sorted[0],
        "Selected most recent FYE period",
        candidates.map((p) => p.periodId),
        excluded,
      );
    }

    case "LATEST_TTM": {
      const candidates = model.periods.filter((p) => p.type === "TTM");
      const excluded = model.periods.filter((p) => p.type !== "TTM").map((p) => p.periodId);
      if (candidates.length === 0) return undefined;
      const sorted = [...candidates].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
      return buildResult(
        sorted[0],
        "Selected most recent TTM period",
        candidates.map((p) => p.periodId),
        excluded,
      );
    }

    case "LATEST_AVAILABLE": {
      if (model.periods.length === 0) return undefined;
      const sorted = [...model.periods].sort((a, b) => b.periodEnd.localeCompare(a.periodEnd));
      const selected = sorted[0];
      return buildResult(
        selected,
        `Selected most recent period (type: ${selected.type})`,
        allIds,
        [],
      );
    }

    case "EXPLICIT": {
      if (!opts.periodId) return undefined;
      const found = model.periods.find((p) => p.periodId === opts.periodId);
      if (!found) return undefined;
      return buildResult(
        found,
        `Explicitly selected period ${opts.periodId}`,
        allIds,
        allIds.filter((id) => id !== opts.periodId),
      );
    }
  }
}
