/**
 * Model Engine V2 — Shared Formula Evaluation + Display Formatting
 *
 * Pure functions extracted from the Moody's renderer logic.
 * No server-only dependencies, no DB calls.
 * Used by the V2 adapter to evaluate rows from FinancialModel data.
 *
 * IMPORTANT: This is a parallel implementation of the same logic in
 * renderMoodysSpread.ts. Do NOT import from that server-only module.
 */

import { MOODYS_FORMULAS } from "@/lib/financialSpreads/moodys/formulas/registry";
import { evaluateMetric } from "@/lib/metrics/evaluateMetric";
import type { MoodysRow } from "@/lib/financialSpreads/moodys/mapping";

// ---------------------------------------------------------------------------
// Structural expression evaluator (same logic as renderMoodysSpread)
// ---------------------------------------------------------------------------

/**
 * Simple structural expression evaluator for sums like "A + B + C" or "A - B".
 * No nested formulas, no precedence beyond left-to-right +/-.
 *
 * For sums, null terms are skipped (treated as 0).
 * If ALL terms are null, returns null.
 */
export function evaluateStructuralExpr(
  expr: string,
  facts: Record<string, number | null>,
): number | null {
  const parts = expr.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;

  let result: number | null = null;
  let op = "+";

  for (const part of parts) {
    if (part === "+" || part === "-") {
      op = part;
      continue;
    }

    const val = facts[part] ?? null;
    if (val === null) {
      if (op === "+" || op === "-") continue;
      return null;
    }

    if (result === null) {
      result = op === "-" ? -val : val;
    } else if (op === "+") {
      result += val;
    } else if (op === "-") {
      result -= val;
    }
  }

  if (result !== null && !Number.isFinite(result)) return null;
  return result;
}

// ---------------------------------------------------------------------------
// Formula evaluator (same logic as renderMoodysSpread)
// ---------------------------------------------------------------------------

/**
 * Evaluate a Moody's formula by its ID.
 * - Formulas with metricRegistryId → delegate to evaluateMetric()
 * - Structural formulas (metricRegistryId: null) → evaluate expression directly
 */
export function evaluateMoodysFormula(
  formulaId: string,
  factsMap: Record<string, number | null>,
): number | null {
  const formula = MOODYS_FORMULAS[formulaId];
  if (!formula) return null;

  if (formula.metricRegistryId) {
    const result = evaluateMetric(formula.metricRegistryId, factsMap);
    return result.value;
  }

  return evaluateStructuralExpr(formula.expr, factsMap);
}

// ---------------------------------------------------------------------------
// Display value formatter (same logic as renderMoodysSpread)
// ---------------------------------------------------------------------------

/**
 * Format a numeric value for display using Moody's row formatting rules.
 * Returns "—" for null values.
 */
export function formatMoodysValue(
  value: number | null,
  row: Pick<MoodysRow, "precision" | "isPercent" | "sign">,
): string {
  if (value === null) return "—";

  const precision = row.precision ?? 0;

  if (row.isPercent) {
    return (value * 100).toFixed(Math.max(0, precision - 2)) + "%";
  }

  if (precision > 0) {
    return value.toFixed(precision);
  }

  if (row.sign === "PAREN_NEGATIVE" && value < 0) {
    return `(${Math.abs(value).toLocaleString("en-US")})`;
  }

  return Math.round(value).toLocaleString("en-US");
}
