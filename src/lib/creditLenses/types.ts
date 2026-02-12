/**
 * Credit Lenses — Shared Types
 *
 * Product-aware underwriting interpretation types.
 * No thresholds, no approvals, no risk grades.
 *
 * PHASE 4B: Interpretation layer only.
 */

export type ProductType = "SBA" | "LOC" | "EQUIPMENT" | "ACQUISITION" | "CRE";

export interface ProductAnalysis {
  product: ProductType;
  periodId: string;
  periodEnd: string;

  keyMetrics: {
    dscr?: number;
    leverage?: number;
    currentRatio?: number;
    quickRatio?: number;
    workingCapital?: number;
    ebitdaMargin?: number;
    netMargin?: number;
  };

  strengths: string[];
  weaknesses: string[];
  riskSignals: string[];
  dataGaps: string[];

  diagnostics: {
    missingMetrics: string[];
    notes: string[];
  };
}
