/**
 * Credit Lenses — Acquisition Lens
 *
 * Interprets CreditSnapshot for acquisition financing.
 * Focus: leverage (critical), EBITDA, net income, working capital.
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

const FOCUS_KEYS = ["leverage", "ebitdaMargin", "netMargin", "workingCapital"];

export function computeAcquisitionLens(snapshot: CreditSnapshot): ProductAnalysis {
  const analysis = buildBaseAnalysis(snapshot, "ACQUISITION");
  const m = snapshot.ratios.metrics;

  // Strengths
  if (isPositive(m.ebitdaMargin)) {
    analysis.strengths.push("Positive EBITDA supports acquisition financing");
  }
  if (isPresent(m.leverageDebtToEbitda)) {
    analysis.strengths.push("Leverage ratio available for assessment");
  }
  if (isPositive(m.netMargin)) {
    analysis.strengths.push("Positive net income");
  }

  // Weaknesses
  if (!isPresent(m.ebitdaMargin)) {
    analysis.weaknesses.push("EBITDA unavailable — cannot assess acquisition capacity");
  }
  if (isNegative(m.workingCapital)) {
    analysis.weaknesses.push("Negative working capital");
  }

  // Risk signals
  if (isPresent(m.leverageDebtToEbitda)) {
    analysis.riskSignals.push("Elevated leverage — acquisition would increase debt load");
  }
  if (snapshot.debtService.totalDebtService === undefined) {
    analysis.riskSignals.push("Missing debt service schedule");
  }

  // Data gaps & diagnostics
  analysis.dataGaps = collectDataGapsFromDiagnostics(snapshot, FOCUS_KEYS);
  analysis.diagnostics.missingMetrics = collectMissingMetrics(snapshot, FOCUS_KEYS);

  return analysis;
}
