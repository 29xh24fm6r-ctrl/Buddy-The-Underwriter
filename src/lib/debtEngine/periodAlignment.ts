/**
 * Debt Engine — Period Alignment
 *
 * Aligns computed annual debt service to a CreditSnapshot period.
 *
 * PHASE 4C: No proration. All period types use full annual DS.
 * Interim proration deferred to future phase.
 */

import type { PeriodType } from "@/lib/modelEngine/types";
import type { AlignedDebtService, PeriodAlignmentType, PortfolioServiceResult } from "./types";

function mapPeriodType(type: PeriodType): PeriodAlignmentType {
  switch (type) {
    case "FYE":
      return "FY";
    case "TTM":
      return "TTM";
    case "YTD":
      return "INTERIM";
  }
}

/**
 * Align portfolio debt service to the selected analysis period.
 *
 * Phase 4C rules:
 * - FY: full annual debt service
 * - TTM: full annual debt service (no adjustment)
 * - INTERIM: full annual debt service (no proration in Phase 4C)
 *
 * Pure function — deterministic, no side effects.
 */
export function alignDebtServiceToPeriod(
  portfolio: PortfolioServiceResult,
  periodType: PeriodType,
): AlignedDebtService {
  const alignmentType = mapPeriodType(periodType);
  const notes: string[] = [];

  if (alignmentType === "INTERIM") {
    notes.push("No proration in Phase 4C — using full annual debt service for interim period.");
  }

  return {
    annualDebtService: portfolio.totalAnnualDebtService,
    alignmentType,
    diagnostics: notes.length > 0 ? { notes } : undefined,
  };
}
