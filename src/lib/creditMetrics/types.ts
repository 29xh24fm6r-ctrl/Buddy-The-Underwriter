/**
 * Credit Metrics — Shared Types
 *
 * Deterministic, explainable credit analytics types.
 * All metrics use MetricResult with full audit trail.
 *
 * PHASE 4A: Analytics foundation only — no UI, no policy, no memo generation.
 */

import type { PeriodType } from "@/lib/modelEngine/types";

// ---------------------------------------------------------------------------
// Period Selection
// ---------------------------------------------------------------------------

export type PeriodSelectionStrategy =
  | "LATEST_FY"
  | "LATEST_TTM"
  | "LATEST_AVAILABLE"
  | "EXPLICIT";

export interface PeriodSelectionOpts {
  strategy: PeriodSelectionStrategy;
  /** Required when strategy === "EXPLICIT" */
  periodId?: string;
}

/**
 * Options for computeCreditSnapshot.
 * Extends period selection with optional debt instrument schedule.
 *
 * When instruments are provided, the debt engine computes true annualized
 * debt service (replacing the Phase 4A interest-expense proxy).
 */
export interface CreditSnapshotOpts extends PeriodSelectionOpts {
  /** Debt instruments for institutional DS calculation (Phase 4C) */
  instruments?: import("@/lib/debtEngine/types").DebtInstrument[];
}

export interface SelectedPeriodResult {
  periodId: string;
  periodEnd: string;
  type: PeriodType;
  diagnostics: {
    reason: string;
    candidatePeriods: string[];
    excludedPeriods: string[];
  };
}

// ---------------------------------------------------------------------------
// Metric Result
// ---------------------------------------------------------------------------

export interface MetricResult {
  value: number | undefined;
  inputs: Record<string, number | undefined>;
  formula: string;
  diagnostics?: {
    missingInputs?: string[];
    divideByZero?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Debt Service
// ---------------------------------------------------------------------------

export interface DebtServiceResult {
  totalDebtService: number | undefined;
  breakdown: {
    proposed: number | undefined;
    existing: number | undefined;
  };
  diagnostics: {
    source: string;
    missingComponents?: string[];
  };
}

// ---------------------------------------------------------------------------
// Core Credit Metrics
// ---------------------------------------------------------------------------

export interface CoreCreditMetrics {
  periodId: string;
  metrics: {
    dscr?: MetricResult;
    leverageDebtToEbitda?: MetricResult;
    currentRatio?: MetricResult;
    quickRatio?: MetricResult;
    workingCapital?: MetricResult;
    ebitdaMargin?: MetricResult;
    netMargin?: MetricResult;
  };
}

// ---------------------------------------------------------------------------
// Credit Snapshot
// ---------------------------------------------------------------------------

export interface CreditSnapshot {
  dealId: string;
  period: SelectedPeriodResult;
  debtService: DebtServiceResult;
  ratios: CoreCreditMetrics;
  generatedAt: string;
}
