/**
 * Shared debt service math — standard amortization payment calculation.
 *
 * Used by:
 *   - computeStructuralPricing.ts (from loan request)
 *   - computeStructuralPricingFromInputs.ts (from pricing assumptions)
 *
 * Same formula as financialStressEngine.ts:computeAnnualDebtService().
 */

export type DebtServiceInput = {
  principal: number;
  ratePct: number;
  amortMonths: number;
  interestOnlyMonths: number;
};

export type DebtServiceOutput = {
  monthlyPayment: number | null;
  annualDebtService: number | null;
};

/**
 * Standard amortization payment calculation.
 *
 * - If principal <= 0 or rate <= 0: returns null.
 * - If interestOnlyMonths >= amortMonths: pure interest-only.
 * - If rate === 0: straight-line principal / months.
 * - Otherwise: standard PMT = P × r / (1 − (1+r)^−n).
 *
 * Never throws. Never returns NaN/Infinity.
 */
export function computeDebtService(args: DebtServiceInput): DebtServiceOutput {
  const { principal, ratePct, amortMonths, interestOnlyMonths } = args;

  if (!principal || principal <= 0 || !ratePct || ratePct <= 0) {
    // Special case: zero rate with valid principal
    if (principal > 0 && ratePct === 0 && amortMonths > 0) {
      const monthly = principal / amortMonths;
      return { monthlyPayment: monthly, annualDebtService: monthly * 12 };
    }
    return { monthlyPayment: null, annualDebtService: null };
  }

  const rateDecimal = ratePct / 100;

  // If fully interest-only or no amort
  if (interestOnlyMonths >= amortMonths || amortMonths <= 0) {
    const monthly = (principal * rateDecimal) / 12;
    return { monthlyPayment: monthly, annualDebtService: monthly * 12 };
  }

  const r = rateDecimal / 12;
  const n = amortMonths;

  if (r === 0) {
    const monthly = principal / n;
    return { monthlyPayment: monthly, annualDebtService: monthly * 12 };
  }

  const pmt = (principal * r) / (1 - Math.pow(1 + r, -n));

  // Guard against non-finite results
  if (!Number.isFinite(pmt)) {
    return { monthlyPayment: null, annualDebtService: null };
  }

  return { monthlyPayment: pmt, annualDebtService: pmt * 12 };
}

/**
 * Resolve the effective rate from pricing inputs.
 *
 * - Fixed: uses fixed_rate_pct directly
 * - Floating: max(floor_rate_pct, index_rate_pct + spread_bps/100)
 */
export function resolveEffectiveRate(args: {
  rateType: "fixed" | "floating";
  fixedRatePct?: number | null;
  indexRatePct?: number | null;
  spreadBps?: number | null;
  floorRatePct?: number | null;
}): number | null {
  if (args.rateType === "fixed") {
    return args.fixedRatePct ?? null;
  }

  // Floating
  const indexRate = args.indexRatePct ?? 0;
  const spreadPct = args.spreadBps != null ? args.spreadBps / 100 : 0;
  const computed = indexRate + spreadPct;
  const floor = args.floorRatePct ?? 0;

  return Math.max(floor, computed);
}
