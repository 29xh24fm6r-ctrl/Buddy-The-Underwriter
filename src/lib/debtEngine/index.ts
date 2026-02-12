/**
 * Debt Engine — Public API
 *
 * Institutional debt service computation.
 * Supports amortizing, IO, balloon, multi-instrument portfolios.
 *
 * PHASE 4C: Pure math — no policy, no stress, no UI.
 */

// Re-export types
export type {
  DebtInstrument,
  InstrumentServiceResult,
  PortfolioServiceResult,
  AlignedDebtService,
  PaymentFrequency,
  PeriodAlignmentType,
} from "./types";

// Re-export computation functions
export { computeAnnualDebtService } from "./amortization";
export { computeDebtPortfolioService } from "./portfolio";
export { alignDebtServiceToPeriod } from "./periodAlignment";
