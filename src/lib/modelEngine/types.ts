/**
 * Model Engine V2 — Core Types
 *
 * Strict, deterministic types for the parallel financial modeling engine.
 * No renderer logic. No spread coupling.
 */

// ---------------------------------------------------------------------------
// Period types
// ---------------------------------------------------------------------------

export type PeriodType = "FYE" | "TTM" | "YTD";

export interface FinancialPeriod {
  periodId: string;
  periodEnd: string; // ISO date (YYYY-MM-DD)
  type: PeriodType;

  income: {
    revenue?: number;
    cogs?: number;
    operatingExpenses?: number;
    depreciation?: number;
    interest?: number;
    netIncome?: number;
  };

  balance: {
    cash?: number;
    accountsReceivable?: number;
    inventory?: number;
    totalAssets?: number;
    shortTermDebt?: number;
    longTermDebt?: number;
    totalLiabilities?: number;
    equity?: number;
  };

  cashflow: {
    ebitda?: number;
    capex?: number;
    cfads?: number;
  };

  qualityFlags: string[];
}

export interface FinancialModel {
  dealId: string;
  periods: FinancialPeriod[];
}

// ---------------------------------------------------------------------------
// Metric definitions (DB-backed)
// ---------------------------------------------------------------------------

export type FormulaOp = "add" | "subtract" | "multiply" | "divide";

export interface FormulaNode {
  type: FormulaOp;
  left: string;    // metric key or literal
  right: string;   // metric key or literal
}

export interface MetricDefinition {
  id: string;
  version: string;
  key: string;
  dependsOn: string[];
  formula: FormulaNode;
  description?: string;
  regulatoryReference?: string;
}

// ---------------------------------------------------------------------------
// Capital model
// ---------------------------------------------------------------------------

export interface LoanAssumptions {
  loanAmount?: number;
  interestRate?: number;
  termYears?: number;
  amortizationYears?: number;
}

export interface CapitalModelResult {
  totalDebt: number | null;
  baseDebtService: number | null;
  leverage: number | null;
}

// ---------------------------------------------------------------------------
// Risk engine
// ---------------------------------------------------------------------------

export type RiskSeverity = "LOW" | "MEDIUM" | "HIGH";

export interface RiskFlag {
  key: string;
  value: number;
  threshold: number;
  severity: RiskSeverity;
}

export interface RiskResult {
  flags: RiskFlag[];
}

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export interface ModelSnapshot {
  id?: string;
  dealId: string;
  bankId: string;
  modelVersion: string;
  metricRegistryHash: string;
  financialModelHash: string;
  calculatedAt: string;
  triggeredBy?: string | null;
}

// ---------------------------------------------------------------------------
// Preview response
// ---------------------------------------------------------------------------

export interface ModelPreviewResult {
  financialModel: FinancialModel;
  computedMetrics: Record<string, number | null>;
  riskFlags: RiskFlag[];
  capitalModel: CapitalModelResult;
  meta: {
    modelVersion: string;
    metricRegistryHash: string;
    financialModelHash: string;
    periodCount: number;
    computedAt: string;
  };
}
