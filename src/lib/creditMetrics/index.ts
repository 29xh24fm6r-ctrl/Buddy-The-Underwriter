/**
 * Credit Metrics — Integration Entrypoint
 *
 * Single function: computeCreditSnapshot()
 * Orchestrates period selection → debt service → credit ratios.
 *
 * PHASE 4A: Analytics foundation — no UI, no policy, no memo generation.
 * PHASE 4C: Optional institutional debt service via instruments.
 */

import type { FinancialModel } from "@/lib/modelEngine/types";
import type { CreditSnapshot, CreditSnapshotOpts, DebtServiceResult } from "./types";
import { selectAnalysisPeriod } from "./periodSelection";
import { computeDebtServiceForPeriod } from "./debtService";
import { computeCoreCreditMetrics } from "./ratios";
import { computeDebtPortfolioService, alignDebtServiceToPeriod } from "@/lib/debtEngine";
import type { DebtInstrument } from "@/lib/debtEngine/types";

// Re-export all types for consumer convenience
export type {
  CreditSnapshot,
  CreditSnapshotOpts,
  CoreCreditMetrics,
  DebtServiceResult,
  MetricResult,
  PeriodSelectionOpts,
  PeriodSelectionStrategy,
  SelectedPeriodResult,
} from "./types";

// Re-export sub-modules for direct access
export { selectAnalysisPeriod } from "./periodSelection";
export { computeDebtServiceForPeriod } from "./debtService";
export { computeCoreCreditMetrics } from "./ratios";
export { safeDivide, safeSum, buildDiagnostics } from "./explain";

// ---------------------------------------------------------------------------
// Debt service resolution (Phase 4C)
// ---------------------------------------------------------------------------

/**
 * Map debt engine portfolio result → CreditSnapshot DebtServiceResult.
 * Splits existing vs proposed instruments.
 */
function resolveDebtServiceFromInstruments(
  instruments: DebtInstrument[],
  periodType: import("@/lib/modelEngine/types").PeriodType,
): DebtServiceResult {
  const portfolio = computeDebtPortfolioService(instruments);
  const aligned = alignDebtServiceToPeriod(portfolio, periodType);

  // Split existing vs proposed
  const existingInstruments = instruments.filter((i) => i.source === "existing");
  const proposedInstruments = instruments.filter((i) => i.source === "proposed");

  let existingDS: number | undefined;
  let proposedDS: number | undefined;

  if (existingInstruments.length > 0) {
    const existingPortfolio = computeDebtPortfolioService(existingInstruments);
    existingDS = existingPortfolio.totalAnnualDebtService;
  }

  if (proposedInstruments.length > 0) {
    const proposedPortfolio = computeDebtPortfolioService(proposedInstruments);
    proposedDS = proposedPortfolio.totalAnnualDebtService;
  }

  const missingComponents: string[] = [];
  if (portfolio.diagnostics?.invalidInstruments) {
    for (const id of portfolio.diagnostics.invalidInstruments) {
      missingComponents.push(`Invalid instrument: ${id}`);
    }
  }

  return {
    totalDebtService: aligned.annualDebtService,
    breakdown: {
      existing: existingDS,
      proposed: proposedDS,
    },
    diagnostics: {
      source: "debtEngine",
      missingComponents: missingComponents.length > 0 ? missingComponents : undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Compute a full credit snapshot for a deal.
 *
 * Orchestrates:
 *   1. Period selection
 *   2. Debt service (via instruments if provided, otherwise interest proxy)
 *   3. Core credit ratios
 *
 * Returns undefined when no suitable period is found.
 *
 * Pure function — deterministic, no side effects.
 */
export function computeCreditSnapshot(
  model: FinancialModel,
  opts: CreditSnapshotOpts,
): CreditSnapshot | undefined {
  const period = selectAnalysisPeriod(model, opts);
  if (!period) return undefined;

  // Phase 4C: use debt engine when instruments are provided
  const debtService =
    opts.instruments && opts.instruments.length > 0
      ? resolveDebtServiceFromInstruments(opts.instruments, period.type)
      : computeDebtServiceForPeriod(model, period.periodId);

  const ratios = computeCoreCreditMetrics(model, period.periodId, debtService);

  return {
    dealId: model.dealId,
    period,
    debtService,
    ratios,
    generatedAt: new Date().toISOString(),
  };
}
