/**
 * Credit Lenses — CRE (Commercial Real Estate) Lens
 *
 * Interprets CreditSnapshot for commercial real estate products.
 * Focus: DSCR, leverage, net income.
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

const FOCUS_KEYS = ["dscr", "leverage", "netMargin"];

export function computeCreLens(snapshot: CreditSnapshot): ProductAnalysis {
  const analysis = buildBaseAnalysis(snapshot, "CRE");
  const m = snapshot.ratios.metrics;

  // Strengths
  if (isPositive(m.dscr)) {
    analysis.strengths.push("Debt service coverage available");
  }
  if (isPositive(m.netMargin)) {
    analysis.strengths.push("Positive net income");
  }

  // Weaknesses
  if (!isPresent(m.dscr)) {
    analysis.weaknesses.push("Debt service coverage unavailable");
  }
  if (isNegative(m.netMargin)) {
    analysis.weaknesses.push("Negative net income");
  }

  // Risk signals
  if (isPresent(m.leverageDebtToEbitda)) {
    analysis.riskSignals.push("Elevated leverage");
  }

  // Data gaps & diagnostics
  analysis.dataGaps = collectDataGapsFromDiagnostics(snapshot, FOCUS_KEYS);
  analysis.diagnostics.missingMetrics = collectMissingMetrics(snapshot, FOCUS_KEYS);

  return analysis;
}
