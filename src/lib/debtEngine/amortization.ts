/**
 * Debt Engine — Amortization
 *
 * Computes annualized debt service for a single instrument.
 * Supports: standard amortizing, interest-only, balloon.
 *
 * PHASE 4C: Pure math — no policy, no stress.
 *
 * PMT formula: P * r * (1+r)^n / ((1+r)^n - 1)
 * Where: P = principal, r = periodic rate, n = number of periods.
 * When r = 0: PMT = P / n (pure principal, no interest).
 *
 * For underwriting DSCR, we compute the fully-amortizing annual payment
 * (post-IO steady state), since that's the conservative assumption.
 * Balloon principal is excluded from annual DS per banking convention.
 */

import type { DebtInstrument, InstrumentServiceResult } from "./types";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function periodsPerYear(freq: DebtInstrument["paymentFrequency"]): number {
  switch (freq) {
    case "monthly":
      return 12;
    case "quarterly":
      return 4;
    case "annual":
      return 1;
  }
}

function amortPeriodsForFrequency(
  amortMonths: number,
  freq: DebtInstrument["paymentFrequency"],
): number {
  switch (freq) {
    case "monthly":
      return amortMonths;
    case "quarterly":
      return Math.ceil(amortMonths / 3);
    case "annual":
      return Math.ceil(amortMonths / 12);
  }
}

/**
 * Standard PMT calculation.
 * Returns periodic payment (principal + interest combined).
 */
function pmt(principal: number, periodicRate: number, numPeriods: number): number {
  if (periodicRate === 0) {
    return principal / numPeriods;
  }
  const factor = Math.pow(1 + periodicRate, numPeriods);
  return (principal * periodicRate * factor) / (factor - 1);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute annualized debt service for a single instrument.
 *
 * Returns the fully-amortizing annual payment (post-IO).
 * Balloon principal excluded from annual DS.
 *
 * Pure function — deterministic, no side effects.
 */
export function computeAnnualDebtService(instrument: DebtInstrument): InstrumentServiceResult {
  const { id, principal, rate, amortizationMonths, interestOnlyMonths, paymentFrequency } =
    instrument;

  // Validate inputs
  const missingInputs: string[] = [];
  const notes: string[] = [];

  if (principal === undefined || principal === null) missingInputs.push("principal");
  if (rate === undefined || rate === null) missingInputs.push("rate");
  if (amortizationMonths === undefined || amortizationMonths === null)
    missingInputs.push("amortizationMonths");

  if (missingInputs.length > 0) {
    return {
      instrumentId: id,
      annualDebtService: undefined,
      periodicDebtService: undefined,
      breakdown: { principal: undefined, interest: undefined },
      diagnostics: { missingInputs },
    };
  }

  if (principal < 0) {
    return {
      instrumentId: id,
      annualDebtService: undefined,
      periodicDebtService: undefined,
      breakdown: { principal: undefined, interest: undefined },
      diagnostics: { unsupportedStructure: true, notes: ["Negative principal"] },
    };
  }

  if (principal === 0) {
    return {
      instrumentId: id,
      annualDebtService: 0,
      periodicDebtService: 0,
      breakdown: { principal: 0, interest: 0 },
    };
  }

  if (rate < 0) {
    return {
      instrumentId: id,
      annualDebtService: undefined,
      periodicDebtService: undefined,
      breakdown: { principal: undefined, interest: undefined },
      diagnostics: { unsupportedStructure: true, notes: ["Negative rate"] },
    };
  }

  if (amortizationMonths <= 0) {
    return {
      instrumentId: id,
      annualDebtService: undefined,
      periodicDebtService: undefined,
      breakdown: { principal: undefined, interest: undefined },
      diagnostics: { unsupportedStructure: true, notes: ["Non-positive amortization months"] },
    };
  }

  const ppy = periodsPerYear(paymentFrequency);
  const periodicRate = rate / ppy;
  const numPeriods = amortPeriodsForFrequency(amortizationMonths, paymentFrequency);

  // Compute the fully-amortizing periodic payment
  const periodicPayment = pmt(principal, periodicRate, numPeriods);
  const annualDS = periodicPayment * ppy;

  // Break down first-period P&I for disclosure
  const firstInterest = principal * periodicRate;
  const firstPrincipal = periodicPayment - firstInterest;

  // Annualized breakdown
  const annualInterest = firstInterest * ppy;
  const annualPrincipal = annualDS - annualInterest;

  if (interestOnlyMonths && interestOnlyMonths > 0) {
    notes.push(`IO period: ${interestOnlyMonths} months. DS reflects post-IO amortizing payment.`);
  }

  if (instrument.balloon) {
    notes.push("Balloon payment excluded from annual debt service.");
  }

  return {
    instrumentId: id,
    annualDebtService: annualDS,
    periodicDebtService: periodicPayment,
    breakdown: {
      principal: annualPrincipal,
      interest: annualInterest,
    },
    diagnostics: notes.length > 0 ? { notes } : undefined,
  };
}
