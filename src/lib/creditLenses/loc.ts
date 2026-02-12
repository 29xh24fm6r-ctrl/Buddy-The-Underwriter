/**
 * Credit Lenses — LOC (Line of Credit) Lens
 *
 * Interprets CreditSnapshot for revolving credit products.
 * Focus: current ratio, quick ratio, working capital, margins.
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

const FOCUS_KEYS = ["currentRatio", "quickRatio", "workingCapital", "ebitdaMargin"];

export function computeLocLens(snapshot: CreditSnapshot): ProductAnalysis {
  const analysis = buildBaseAnalysis(snapshot, "LOC");
  const m = snapshot.ratios.metrics;

  // Strengths
  if (isPositive(m.workingCapital)) {
    analysis.strengths.push("Positive working capital supports revolving credit");
  }
  if (isPresent(m.currentRatio)) {
    analysis.strengths.push("Current ratio available for liquidity assessment");
  }
  if (isPresent(m.quickRatio)) {
    analysis.strengths.push("Quick ratio available");
  }

  // Weaknesses
  if (isNegative(m.workingCapital)) {
    analysis.weaknesses.push("Negative working capital — potential liquidity strain");
  }
  if (!isPresent(m.currentRatio)) {
    analysis.weaknesses.push("Current ratio unavailable");
  }

  // Risk signals
  if (isNegative(m.ebitdaMargin)) {
    analysis.riskSignals.push("Negative operating margin");
  }

  // Data gaps & diagnostics
  analysis.dataGaps = collectDataGapsFromDiagnostics(snapshot, FOCUS_KEYS);
  analysis.diagnostics.missingMetrics = collectMissingMetrics(snapshot, FOCUS_KEYS);

  return analysis;
}
