/**
 * Debt Engine — Portfolio Aggregation
 *
 * Aggregates debt service across multiple instruments.
 * Any invalid instrument contributes diagnostics but does not block others.
 *
 * PHASE 4C: Pure math — no policy, no stress.
 */

import type { DebtInstrument, InstrumentServiceResult, PortfolioServiceResult } from "./types";
import { computeAnnualDebtService } from "./amortization";

/**
 * Compute total annual debt service across a portfolio of instruments.
 *
 * Rules:
 * - Each instrument computed independently
 * - Invalid instruments tracked in diagnostics
 * - Total is sum of all valid instruments
 * - If ALL instruments are invalid, total is undefined
 *
 * Pure function — deterministic, no side effects.
 */
export function computeDebtPortfolioService(
  instruments: DebtInstrument[],
): PortfolioServiceResult {
  if (instruments.length === 0) {
    return {
      totalAnnualDebtService: undefined,
      totalPrincipalComponent: undefined,
      totalInterestComponent: undefined,
      instrumentBreakdown: {},
      diagnostics: { notes: ["No instruments provided"] },
    };
  }

  const breakdown: Record<string, InstrumentServiceResult> = {};
  const invalidInstruments: string[] = [];
  let totalDS = 0;
  let totalPrincipal = 0;
  let totalInterest = 0;
  let validCount = 0;

  for (const instrument of instruments) {
    const result = computeAnnualDebtService(instrument);
    breakdown[instrument.id] = result;

    if (result.annualDebtService !== undefined) {
      totalDS += result.annualDebtService;
      totalPrincipal += result.breakdown.principal ?? 0;
      totalInterest += result.breakdown.interest ?? 0;
      validCount++;
    } else {
      invalidInstruments.push(instrument.id);
    }
  }

  if (validCount === 0) {
    return {
      totalAnnualDebtService: undefined,
      totalPrincipalComponent: undefined,
      totalInterestComponent: undefined,
      instrumentBreakdown: breakdown,
      diagnostics: { invalidInstruments },
    };
  }

  return {
    totalAnnualDebtService: totalDS,
    totalPrincipalComponent: totalPrincipal,
    totalInterestComponent: totalInterest,
    instrumentBreakdown: breakdown,
    diagnostics: invalidInstruments.length > 0 ? { invalidInstruments } : undefined,
  };
}
