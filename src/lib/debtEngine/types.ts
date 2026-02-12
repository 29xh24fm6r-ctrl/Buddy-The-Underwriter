/**
 * Debt Engine — Types
 *
 * Institutional debt service computation types.
 * Supports amortizing, IO, balloon, and multi-instrument portfolios.
 *
 * PHASE 4C: Pure math — no policy, no stress, no UI.
 */

// ---------------------------------------------------------------------------
// Debt Instrument
// ---------------------------------------------------------------------------

export type PaymentFrequency = "monthly" | "quarterly" | "annual";

export interface DebtInstrument {
  id: string;
  source: "existing" | "proposed";
  principal: number;
  /** Annual interest rate as decimal (e.g. 0.065 for 6.5%) */
  rate: number;
  /** Total amortization schedule in months */
  amortizationMonths: number;
  /** Loan term in months (may differ from amortization for balloon) */
  termMonths?: number;
  /** Interest-only period in months at start of loan */
  interestOnlyMonths?: number;
  /** Whether the loan has a balloon payment at maturity */
  balloon?: boolean;
  paymentFrequency: PaymentFrequency;
}

// ---------------------------------------------------------------------------
// Per-Instrument Result
// ---------------------------------------------------------------------------

export interface InstrumentServiceResult {
  instrumentId: string;
  /** Annualized debt service (principal + interest) */
  annualDebtService: number | undefined;
  /** Single periodic payment amount */
  periodicDebtService: number | undefined;
  breakdown: {
    /** Annual principal component */
    principal: number | undefined;
    /** Annual interest component */
    interest: number | undefined;
  };
  diagnostics?: {
    missingInputs?: string[];
    unsupportedStructure?: boolean;
    notes?: string[];
  };
}

// ---------------------------------------------------------------------------
// Portfolio Result
// ---------------------------------------------------------------------------

export interface PortfolioServiceResult {
  totalAnnualDebtService: number | undefined;
  totalPrincipalComponent: number | undefined;
  totalInterestComponent: number | undefined;
  instrumentBreakdown: Record<string, InstrumentServiceResult>;
  diagnostics?: {
    invalidInstruments?: string[];
    notes?: string[];
  };
}

// ---------------------------------------------------------------------------
// Period-Aligned Result
// ---------------------------------------------------------------------------

export type PeriodAlignmentType = "FY" | "TTM" | "INTERIM";

export interface AlignedDebtService {
  annualDebtService: number | undefined;
  alignmentType: PeriodAlignmentType;
  diagnostics?: {
    notes?: string[];
  };
}
