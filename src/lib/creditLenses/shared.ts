/**
 * Credit Lenses — Shared Helpers
 *
 * Common metric extraction and directional signal helpers.
 * Used by all product lenses to stay DRY.
 *
 * PHASE 4B: Interpretation layer only.
 */

import type { CreditSnapshot, MetricResult } from "@/lib/creditMetrics/types";
import type { ProductAnalysis, ProductType } from "./types";

// ---------------------------------------------------------------------------
// Metric extraction
// ---------------------------------------------------------------------------

/**
 * Extract flat keyMetrics from a CreditSnapshot.
 * Reads .value from each MetricResult — undefined if absent.
 */
export function extractKeyMetrics(snapshot: CreditSnapshot): ProductAnalysis["keyMetrics"] {
  const m = snapshot.ratios.metrics;
  return {
    dscr: m.dscr?.value,
    leverage: m.leverageDebtToEbitda?.value,
    currentRatio: m.currentRatio?.value,
    quickRatio: m.quickRatio?.value,
    workingCapital: m.workingCapital?.value,
    ebitdaMargin: m.ebitdaMargin?.value,
    netMargin: m.netMargin?.value,
  };
}

// ---------------------------------------------------------------------------
// Missing metric detection
// ---------------------------------------------------------------------------

const METRIC_KEY_MAP: Record<string, keyof NonNullable<CreditSnapshot["ratios"]["metrics"]>> = {
  dscr: "dscr",
  leverage: "leverageDebtToEbitda",
  currentRatio: "currentRatio",
  quickRatio: "quickRatio",
  workingCapital: "workingCapital",
  ebitdaMargin: "ebitdaMargin",
  netMargin: "netMargin",
};

/**
 * Collect metric names that are missing (value === undefined) from the focus set.
 */
export function collectMissingMetrics(
  snapshot: CreditSnapshot,
  focusKeys: string[],
): string[] {
  const missing: string[] = [];
  for (const key of focusKeys) {
    const metricKey = METRIC_KEY_MAP[key];
    if (!metricKey) continue;
    const metric = snapshot.ratios.metrics[metricKey];
    if (!metric || metric.value === undefined) {
      missing.push(key);
    }
  }
  return missing;
}

// ---------------------------------------------------------------------------
// Data gap collection from diagnostics
// ---------------------------------------------------------------------------

/**
 * Collect human-readable data gap strings from metric diagnostics.
 */
export function collectDataGapsFromDiagnostics(
  snapshot: CreditSnapshot,
  focusKeys: string[],
): string[] {
  const gaps: string[] = [];
  const seen = new Set<string>();

  for (const key of focusKeys) {
    const metricKey = METRIC_KEY_MAP[key];
    if (!metricKey) continue;
    const metric = snapshot.ratios.metrics[metricKey];
    if (!metric) continue;

    if (metric.diagnostics?.missingInputs) {
      for (const input of metric.diagnostics.missingInputs) {
        const msg = `Missing ${input}`;
        if (!seen.has(msg)) {
          seen.add(msg);
          gaps.push(msg);
        }
      }
    }
    if (metric.diagnostics?.divideByZero) {
      const msg = `Division by zero in ${key} calculation`;
      if (!seen.has(msg)) {
        seen.add(msg);
        gaps.push(msg);
      }
    }
  }

  // Debt service diagnostics
  if (snapshot.debtService.diagnostics.missingComponents) {
    for (const comp of snapshot.debtService.diagnostics.missingComponents) {
      const msg = `Missing ${comp}`;
      if (!seen.has(msg)) {
        seen.add(msg);
        gaps.push(msg);
      }
    }
  }

  return gaps;
}

// ---------------------------------------------------------------------------
// Directional signal helpers
// ---------------------------------------------------------------------------

/** Value is defined (not undefined). */
export function isPresent(metric: MetricResult | undefined): boolean {
  return metric !== undefined && metric.value !== undefined;
}

/** Value is defined and > 0. */
export function isPositive(metric: MetricResult | undefined): boolean {
  return metric !== undefined && metric.value !== undefined && metric.value > 0;
}

/** Value is defined and < 0. */
export function isNegative(metric: MetricResult | undefined): boolean {
  return metric !== undefined && metric.value !== undefined && metric.value < 0;
}

// ---------------------------------------------------------------------------
// Base analysis builder
// ---------------------------------------------------------------------------

/**
 * Create a base ProductAnalysis with keyMetrics populated and empty signal arrays.
 * Each lens calls this, then adds its product-specific interpretations.
 */
export function buildBaseAnalysis(
  snapshot: CreditSnapshot,
  product: ProductType,
): ProductAnalysis {
  return {
    product,
    periodId: snapshot.period.periodId,
    periodEnd: snapshot.period.periodEnd,
    keyMetrics: extractKeyMetrics(snapshot),
    strengths: [],
    weaknesses: [],
    riskSignals: [],
    dataGaps: [],
    diagnostics: {
      missingMetrics: [],
      notes: [],
    },
  };
}
