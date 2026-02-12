/**
 * Stress Engine — Model Transforms
 *
 * Pure functions that apply stress shocks to financial models and instruments.
 * All transforms produce shallow copies — never mutate inputs.
 *
 * PHASE 5B: Pure transforms — no DB, no side effects.
 */

import type { FinancialModel, FinancialPeriod } from "@/lib/modelEngine/types";
import type { DebtInstrument } from "@/lib/debtEngine/types";

// ---------------------------------------------------------------------------
// EBITDA Haircut
// ---------------------------------------------------------------------------

/**
 * Apply an EBITDA haircut to all periods in a financial model.
 *
 * - haircut = 0.10 → EBITDA reduced by 10%
 * - Undefined EBITDA stays undefined (no coercion)
 * - Returns a new model; input is never mutated
 */
export function applyEbitdaHaircut(
  model: FinancialModel,
  haircut: number,
): FinancialModel {
  return {
    ...model,
    periods: model.periods.map((p): FinancialPeriod => ({
      ...p,
      cashflow: {
        ...p.cashflow,
        ebitda:
          p.cashflow.ebitda !== undefined
            ? p.cashflow.ebitda * (1 - haircut)
            : undefined,
      },
    })),
  };
}

// ---------------------------------------------------------------------------
// Revenue Haircut
// ---------------------------------------------------------------------------

/**
 * Apply a revenue haircut to all periods in a financial model.
 *
 * - haircut = 0.10 → revenue reduced by 10%
 * - Undefined revenue stays undefined
 * - Does NOT affect EBITDA (separate field on FinancialPeriod)
 * - Returns a new model; input is never mutated
 */
export function applyRevenueHaircut(
  model: FinancialModel,
  haircut: number,
): FinancialModel {
  return {
    ...model,
    periods: model.periods.map((p): FinancialPeriod => ({
      ...p,
      income: {
        ...p.income,
        revenue:
          p.income.revenue !== undefined
            ? p.income.revenue * (1 - haircut)
            : undefined,
      },
    })),
  };
}

// ---------------------------------------------------------------------------
// Rate Shock
// ---------------------------------------------------------------------------

/**
 * Apply a rate shock to debt instruments.
 *
 * - shockBps = 200 → each instrument's rate increases by 2.00%
 * - Returns undefined if instruments is undefined or empty
 * - Returns a new array; input is never mutated
 */
export function applyRateShock(
  instruments: DebtInstrument[] | undefined,
  shockBps: number,
): DebtInstrument[] | undefined {
  if (!instruments || instruments.length === 0) return undefined;

  return instruments.map((inst) => ({
    ...inst,
    rate: inst.rate + shockBps / 10_000,
  }));
}
