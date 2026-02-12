/**
 * Credit Metrics — Explainability Helpers
 *
 * Shared utilities for building consistent MetricResult diagnostics.
 * Every metric must be fully explainable: inputs, formula, and why it failed.
 *
 * PHASE 4A: Analytics foundation only.
 */

import type { MetricResult } from "./types";

/**
 * Build diagnostics by scanning inputs for undefined values.
 */
export function buildDiagnostics(
  inputs: Record<string, number | undefined>,
): MetricResult["diagnostics"] {
  const missingInputs: string[] = [];
  for (const [key, val] of Object.entries(inputs)) {
    if (val === undefined) missingInputs.push(key);
  }
  if (missingInputs.length === 0) return undefined;
  return { missingInputs };
}

/**
 * Safe division that never silently coerces undefined→0 or divides by zero.
 *
 * Returns a complete MetricResult with audit trail.
 */
export function safeDivide(
  numeratorKey: string,
  numerator: number | undefined,
  denominatorKey: string,
  denominator: number | undefined,
  inputs: Record<string, number | undefined>,
  formula: string,
): MetricResult {
  const missingInputs: string[] = [];

  if (numerator === undefined) missingInputs.push(numeratorKey);
  if (denominator === undefined) missingInputs.push(denominatorKey);

  if (missingInputs.length > 0) {
    return {
      value: undefined,
      inputs,
      formula,
      diagnostics: { missingInputs },
    };
  }

  // Both are defined at this point
  if (denominator === 0) {
    return {
      value: undefined,
      inputs,
      formula,
      diagnostics: { divideByZero: true },
    };
  }

  return {
    value: numerator! / denominator!,
    inputs,
    formula,
  };
}

/**
 * Safe addition of optional numbers for composite numerators/denominators.
 *
 * Returns undefined if ANY component is undefined (never coerce undefined→0).
 * Also returns the list of missing component names for diagnostics.
 */
export function safeSum(
  components: Record<string, number | undefined>,
): { value: number | undefined; missing: string[] } {
  const missing: string[] = [];
  let sum = 0;

  for (const [key, val] of Object.entries(components)) {
    if (val === undefined) {
      missing.push(key);
    } else {
      sum += val;
    }
  }

  if (missing.length > 0) {
    return { value: undefined, missing };
  }
  return { value: sum, missing: [] };
}
