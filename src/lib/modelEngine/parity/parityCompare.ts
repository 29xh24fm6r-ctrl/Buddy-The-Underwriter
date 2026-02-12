/**
 * Model Engine V2 — Parity Comparator
 *
 * Compares V1 spread output to V2 model engine output using the
 * spec-defined ParityReport shape with materiality thresholds.
 *
 * Read-only. No DB mutation. No lifecycle mutation. No persist.
 */

import {
  extractSpreadParityMetrics,
  extractModelV2ParityMetrics,
  extractSpreadParityMetricsFromData,
  extractModelV2ParityMetricsFromModel,
  type PeriodMetricMap,
  type PeriodMetrics,
  PARITY_METRIC_KEYS,
} from "./parityTargets";
import { CANONICAL_PARITY_METRIC_KEYS } from "./metricDictionary";
import type { V1SpreadData } from "./types";
import type { FinancialModel } from "../types";

// ---------------------------------------------------------------------------
// Materiality threshold
// ---------------------------------------------------------------------------

/**
 * Materiality test per spec:
 * - abs(delta) > 1
 * - OR abs(delta) / max(1, abs(spread)) > 0.0001 (0.01%)
 */
function isMaterial(delta: number, spreadVal: number): boolean {
  if (Math.abs(delta) > 1) return true;
  const denom = Math.max(1, Math.abs(spreadVal));
  if (Math.abs(delta) / denom > 0.0001) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Diff type (per the spec)
// ---------------------------------------------------------------------------

export interface Diff {
  spread: number;
  model: number;
  delta: number;
  pctDelta?: number;
  material: boolean;
}

// ---------------------------------------------------------------------------
// ParityReport (per the spec)
// Keys match CANONICAL_PARITY_METRICS from metricDictionary.ts.
// ---------------------------------------------------------------------------

export interface PeriodDifferences {
  // Income Statement
  revenue?: Diff;
  cogs?: Diff;
  operatingExpenses?: Diff;
  ebitda?: Diff;
  netIncome?: Diff;
  // Balance Sheet
  cash?: Diff;
  totalAssets?: Diff;
  totalLiabilities?: Diff;
  equity?: Diff;
  // Derived
  leverageDebtToEbitda?: Diff;
}

export interface PeriodComparisonEntry {
  periodId: string;
  periodEnd?: string;
  differences: PeriodDifferences;
}

export interface ParityReport {
  dealId: string;
  generatedAt: string;
  periodComparisons: PeriodComparisonEntry[];
  summary: {
    totalDifferences: number;
    materiallyDifferent: boolean;
    maxAbsDelta?: number;
    maxPctDelta?: number;
  };
  notes?: string[];
}

// ---------------------------------------------------------------------------
// Core comparison: PeriodMetricMaps → ParityReport
// ---------------------------------------------------------------------------

export function buildParityReport(
  dealId: string,
  spreadMetrics: PeriodMetricMap,
  modelMetrics: PeriodMetricMap,
): ParityReport {
  const generatedAt = new Date().toISOString();
  const notes: string[] = [];

  // Align periods
  const allPeriodIds = new Set([
    ...Object.keys(spreadMetrics),
    ...Object.keys(modelMetrics),
  ]);

  const periodComparisons: PeriodComparisonEntry[] = [];
  let totalDifferences = 0;
  let materiallyDifferent = false;
  let maxAbsDelta: number | undefined;
  let maxPctDelta: number | undefined;

  for (const periodId of [...allPeriodIds].sort()) {
    const spread = spreadMetrics[periodId];
    const model = modelMetrics[periodId];

    if (!spread && model) {
      notes.push(`Period ${periodId}: exists in V2 model but not in V1 spreads`);
      continue;
    }
    if (spread && !model) {
      notes.push(`Period ${periodId}: exists in V1 spreads but not in V2 model`);
      continue;
    }
    if (!spread || !model) continue;

    const differences: PeriodDifferences = {};

    for (const key of PARITY_METRIC_KEYS) {
      const spreadVal = spread.metrics[key];
      const modelVal = model.metrics[key];

      // If either side missing, skip diff (record a note)
      if (spreadVal === undefined && modelVal === undefined) continue;
      if (spreadVal === undefined) {
        notes.push(`Period ${periodId}, ${key}: present in V2 model but not in V1 spread`);
        continue;
      }
      if (modelVal === undefined) {
        notes.push(`Period ${periodId}, ${key}: present in V1 spread but not in V2 model`);
        continue;
      }

      // Both present — compute diff
      const delta = modelVal - spreadVal;
      const pctDelta = spreadVal !== 0 ? delta / Math.abs(spreadVal) : (modelVal !== 0 ? Infinity : 0);
      const material = isMaterial(delta, spreadVal);

      const diff: Diff = {
        spread: spreadVal,
        model: modelVal,
        delta,
        pctDelta: Number.isFinite(pctDelta) ? pctDelta : undefined,
        material,
      };

      (differences as any)[key] = diff;

      if (delta !== 0) totalDifferences++;
      if (material) materiallyDifferent = true;

      const absDelta = Math.abs(delta);
      if (maxAbsDelta === undefined || absDelta > maxAbsDelta) maxAbsDelta = absDelta;
      if (pctDelta !== undefined && Number.isFinite(pctDelta)) {
        const absPct = Math.abs(pctDelta);
        if (maxPctDelta === undefined || absPct > maxPctDelta) maxPctDelta = absPct;
      }
    }

    periodComparisons.push({
      periodId,
      periodEnd: spread.periodEnd ?? model.periodEnd,
      differences,
    });
  }

  return {
    dealId,
    generatedAt,
    periodComparisons,
    summary: {
      totalDifferences,
      materiallyDifferent,
      maxAbsDelta,
      maxPctDelta,
    },
    notes: notes.length > 0 ? notes : undefined,
  };
}

// ---------------------------------------------------------------------------
// Pure comparison (no DB)
// ---------------------------------------------------------------------------

export function compareSpreadToModelV2Pure(
  dealId: string,
  v1Spreads: V1SpreadData[],
  v2Model: FinancialModel,
): ParityReport {
  const spreadMetrics = extractSpreadParityMetricsFromData(v1Spreads);
  const modelMetrics = extractModelV2ParityMetricsFromModel(v2Model);
  return buildParityReport(dealId, spreadMetrics, modelMetrics);
}

// ---------------------------------------------------------------------------
// DB-backed comparison (read-only)
// ---------------------------------------------------------------------------

export async function compareSpreadToModelV2(
  dealId: string,
  supabase: any,
): Promise<ParityReport> {
  const [spreadMetrics, modelMetrics] = await Promise.all([
    extractSpreadParityMetrics(dealId, supabase),
    extractModelV2ParityMetrics(dealId, supabase),
  ]);
  return buildParityReport(dealId, spreadMetrics, modelMetrics);
}
