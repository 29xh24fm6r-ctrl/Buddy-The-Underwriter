/**
 * Credit Lenses — Equipment Finance Lens
 *
 * Interprets CreditSnapshot for equipment financing products.
 * Focus: leverage, DSCR, EBITDA margin.
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

const FOCUS_KEYS = ["leverage", "dscr", "ebitdaMargin"];

export function computeEquipmentLens(snapshot: CreditSnapshot): ProductAnalysis {
  const analysis = buildBaseAnalysis(snapshot, "EQUIPMENT");
  const m = snapshot.ratios.metrics;

  // Strengths
  if (isPositive(m.dscr)) {
    analysis.strengths.push("Debt service coverage available");
  }
  if (isPositive(m.ebitdaMargin)) {
    analysis.strengths.push("Positive EBITDA");
  }

  // Weaknesses
  if (isPresent(m.leverageDebtToEbitda) && isNegative(m.ebitdaMargin)) {
    analysis.weaknesses.push("Negative EBITDA with existing debt");
  }
  if (!isPresent(m.dscr)) {
    analysis.weaknesses.push("Debt service coverage unavailable");
  }

  // Risk signals
  if (isPresent(m.leverageDebtToEbitda)) {
    analysis.riskSignals.push("Elevated leverage relative to earnings");
  }
  if (snapshot.debtService.totalDebtService === undefined) {
    analysis.riskSignals.push("Debt service data unavailable");
  }

  // Data gaps & diagnostics
  analysis.dataGaps = collectDataGapsFromDiagnostics(snapshot, FOCUS_KEYS);
  analysis.diagnostics.missingMetrics = collectMissingMetrics(snapshot, FOCUS_KEYS);

  return analysis;
}
