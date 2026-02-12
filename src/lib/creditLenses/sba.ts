/**
 * Credit Lenses — SBA Lens
 *
 * Interprets CreditSnapshot for SBA loan products.
 * Focus: DSCR, leverage, EBITDA margin, net margin.
 *
 * PHASE 4B: Interpretation only — no thresholds, no approvals.
 */

import type { CreditSnapshot } from "@/lib/creditMetrics/types";
import type { ProductAnalysis } from "./types";
import {
  buildBaseAnalysis,
  collectDataGapsFromDiagnostics,
  collectMissingMetrics,
  isNegative,
  isPositive,
  isPresent,
} from "./shared";

const FOCUS_KEYS = ["dscr", "leverage", "ebitdaMargin", "netMargin"];

export function computeSbaLens(snapshot: CreditSnapshot): ProductAnalysis {
  const analysis = buildBaseAnalysis(snapshot, "SBA");
  const m = snapshot.ratios.metrics;

  // Strengths
  if (isPositive(m.dscr)) {
    analysis.strengths.push("Debt service coverage ratio available");
  }
  if (isPositive(m.ebitdaMargin)) {
    analysis.strengths.push("Positive EBITDA indicates operating cash flow");
  }
  if (isPositive(m.netMargin)) {
    analysis.strengths.push("Positive net income");
  }

  // Weaknesses
  if (!isPresent(m.dscr)) {
    analysis.weaknesses.push("Debt service coverage ratio unavailable");
  }
  if (isNegative(m.netMargin)) {
    analysis.weaknesses.push("Negative net income");
  }
  if (!isPresent(m.ebitdaMargin)) {
    analysis.weaknesses.push("EBITDA unavailable for cash flow analysis");
  }

  // Risk signals
  if (isNegative(m.workingCapital)) {
    analysis.riskSignals.push("Negative working capital");
  }
  if (isPresent(m.leverageDebtToEbitda)) {
    analysis.riskSignals.push("Elevated debt-to-EBITDA leverage");
  }

  // Data gaps & diagnostics
  analysis.dataGaps = collectDataGapsFromDiagnostics(snapshot, FOCUS_KEYS);
  analysis.diagnostics.missingMetrics = collectMissingMetrics(snapshot, FOCUS_KEYS);

  return analysis;
}
