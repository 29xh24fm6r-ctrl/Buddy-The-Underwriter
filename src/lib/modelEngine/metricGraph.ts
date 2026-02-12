/**
 * Model Engine V2 — Metric Graph
 *
 * Deterministic dependency evaluator:
 * - Topologically sorts metric definitions by dependencies
 * - Evaluates structured JSON formulas (add/subtract/multiply/divide)
 * - No eval(), no silent failures
 * - If a dependency is missing → metric is undefined (not zero)
 */

import type { MetricDefinition, FormulaNode, FormulaOp } from "./types";

// ---------------------------------------------------------------------------
// Topological sort
// ---------------------------------------------------------------------------

/**
 * Topologically sort metric definitions so dependencies are evaluated first.
 * Throws if a cycle is detected.
 */
export function topologicalSort(metrics: MetricDefinition[]): MetricDefinition[] {
  const byKey = new Map<string, MetricDefinition>();
  for (const m of metrics) byKey.set(m.key, m);

  const visited = new Set<string>();
  const visiting = new Set<string>(); // cycle detection
  const sorted: MetricDefinition[] = [];

  function visit(key: string): void {
    if (visited.has(key)) return;
    if (visiting.has(key)) {
      throw new Error(`Cycle detected in metric graph at: ${key}`);
    }

    const def = byKey.get(key);
    if (!def) return; // external dependency (fact key), not a metric

    visiting.add(key);
    for (const dep of def.dependsOn) {
      visit(dep);
    }
    visiting.delete(key);
    visited.add(key);
    sorted.push(def);
  }

  for (const m of metrics) {
    visit(m.key);
  }

  return sorted;
}

// ---------------------------------------------------------------------------
// Formula evaluator
// ---------------------------------------------------------------------------

const VALID_OPS: Set<FormulaOp> = new Set(["add", "subtract", "multiply", "divide"]);

/**
 * Resolve an operand: if it's a numeric literal, parse it.
 * Otherwise look it up in the values map.
 */
function resolveOperand(
  operand: string,
  values: Record<string, number | null>,
): number | null {
  // Try numeric literal first
  const num = Number(operand);
  if (!Number.isNaN(num) && operand.trim() !== "") return num;

  // Look up in computed values
  return values[operand] ?? null;
}

/**
 * Evaluate a single FormulaNode against a values map.
 * Returns null if any operand is missing or if division by zero.
 */
export function evaluateFormula(
  formula: FormulaNode,
  values: Record<string, number | null>,
): number | null {
  if (!formula || !VALID_OPS.has(formula.type)) return null;

  const left = resolveOperand(formula.left, values);
  const right = resolveOperand(formula.right, values);

  if (left === null || right === null) return null;

  switch (formula.type) {
    case "add":
      return left + right;
    case "subtract":
      return left - right;
    case "multiply":
      return left * right;
    case "divide":
      if (right === 0) return null; // no divide-by-zero
      return left / right;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Full graph evaluation
// ---------------------------------------------------------------------------

/**
 * Evaluate all metrics in topological order.
 *
 * @param metrics - MetricDefinitions (will be topologically sorted)
 * @param baseValues - Initial values from the financial model (fact keys → numbers)
 * @returns Map of metric key → computed value (null if dependency missing)
 */
export function evaluateMetricGraph(
  metrics: MetricDefinition[],
  baseValues: Record<string, number | null>,
): Record<string, number | null> {
  const sorted = topologicalSort(metrics);
  const values: Record<string, number | null> = { ...baseValues };

  for (const def of sorted) {
    const result = evaluateFormula(def.formula, values);
    values[def.key] = result;
  }

  return values;
}

// ---------------------------------------------------------------------------
// Diagnostic types + evaluation (for parity debugging)
// ---------------------------------------------------------------------------

export interface DiagnosticEntry {
  code: string;
  message: string;
  metric?: string;
}

export interface FormulaResult {
  value: number | null;
  error?: { code: string; message: string };
}

export interface GraphEvalResult {
  values: Record<string, number | null>;
  diagnostics: DiagnosticEntry[];
}

/**
 * Evaluate a formula with structured diagnostics.
 * Same logic as evaluateFormula but returns typed result with error info.
 */
export function evaluateFormulaWithDiagnostics(
  formula: FormulaNode,
  values: Record<string, number | null>,
  metricKey?: string,
): FormulaResult {
  if (!formula || !VALID_OPS.has(formula.type)) {
    return { value: null, error: { code: "INVALID_OP", message: `Invalid formula op: ${formula?.type}` } };
  }

  const left = resolveOperand(formula.left, values);
  const right = resolveOperand(formula.right, values);

  if (left === null) {
    return { value: null, error: { code: "MISSING_DEPENDENCY", message: `Missing left operand: ${formula.left}${metricKey ? ` (for ${metricKey})` : ""}` } };
  }
  if (right === null) {
    return { value: null, error: { code: "MISSING_DEPENDENCY", message: `Missing right operand: ${formula.right}${metricKey ? ` (for ${metricKey})` : ""}` } };
  }

  switch (formula.type) {
    case "add":
      return { value: left + right };
    case "subtract":
      return { value: left - right };
    case "multiply":
      return { value: left * right };
    case "divide":
      if (right === 0) {
        return { value: null, error: { code: "DIVIDE_BY_ZERO", message: `Division by zero: ${formula.left} / ${formula.right}${metricKey ? ` (for ${metricKey})` : ""}` } };
      }
      return { value: left / right };
    default:
      return { value: null, error: { code: "INVALID_OP", message: `Unknown op: ${formula.type}` } };
  }
}

/**
 * Evaluate all metrics with full diagnostics.
 * Collects structured error entries for missing dependencies, divide-by-zero, etc.
 */
export function evaluateMetricGraphWithDiagnostics(
  metrics: MetricDefinition[],
  baseValues: Record<string, number | null>,
): GraphEvalResult {
  let sorted: MetricDefinition[];
  const diagnostics: DiagnosticEntry[] = [];

  try {
    sorted = topologicalSort(metrics);
  } catch (e: any) {
    return {
      values: { ...baseValues },
      diagnostics: [{ code: "CYCLE_DETECTED", message: e.message }],
    };
  }

  const values: Record<string, number | null> = { ...baseValues };

  for (const def of sorted) {
    const result = evaluateFormulaWithDiagnostics(def.formula, values, def.key);
    values[def.key] = result.value;
    if (result.error) {
      diagnostics.push({ ...result.error, metric: def.key });
    }
  }

  return { values, diagnostics };
}
