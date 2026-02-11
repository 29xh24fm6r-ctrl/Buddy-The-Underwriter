/**
 * Safe Expression Evaluator for Metric Registry
 *
 * Parses simple math expressions (A + B, A / B, A - B, A * B)
 * with fact key references. No eval(), no new Function().
 *
 * Null propagation: any null operand → null result.
 * Divide by zero → null.
 * Never throws, never returns NaN or Infinity.
 */

import { METRIC_REGISTRY, type MetricDefinition } from "@/lib/metrics/registry";

export type EvalResult = {
  value: number | null;
  missingInputs: string[];
};

type Token =
  | { type: "fact"; key: string }
  | { type: "op"; op: "+" | "-" | "*" | "/" }
  | { type: "number"; value: number };

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  const parts = expr.split(/\s+/).filter(Boolean);

  for (const part of parts) {
    if (part === "+" || part === "-" || part === "*" || part === "/") {
      tokens.push({ type: "op", op: part });
    } else if (/^-?\d+(\.\d+)?$/.test(part)) {
      tokens.push({ type: "number", value: Number(part) });
    } else if (/^[A-Z][A-Z0-9_]*$/.test(part)) {
      tokens.push({ type: "fact", key: part });
    } else {
      // Unknown token — treat as fact key (lenient)
      tokens.push({ type: "fact", key: part });
    }
  }

  return tokens;
}

function resolveValue(
  token: Token,
  facts: Record<string, number | null>,
  missingInputs: string[],
): number | null {
  if (token.type === "number") return token.value;
  if (token.type === "fact") {
    const v = facts[token.key];
    if (v === undefined || v === null) {
      missingInputs.push(token.key);
      return null;
    }
    if (!Number.isFinite(v)) return null;
    return v;
  }
  return null;
}

function safeDivide(a: number, b: number): number | null {
  if (b === 0) return null;
  const result = a / b;
  if (!Number.isFinite(result)) return null;
  return result;
}

function applyOp(left: number | null, op: string, right: number | null): number | null {
  if (left === null || right === null) return null;
  switch (op) {
    case "+": return left + right;
    case "-": return left - right;
    case "*": {
      const result = left * right;
      return Number.isFinite(result) ? result : null;
    }
    case "/": return safeDivide(left, right);
    default: return null;
  }
}

/**
 * Evaluate a metric expression from the registry.
 *
 * Supports left-to-right evaluation of simple expressions:
 *   "A + B - C" → (A + B) - C
 *   "A / B"     → A / B
 *   "A"         → A (identity)
 *
 * For expressions requiring precedence (* / before + -), we evaluate
 * multiplication and division first, then addition and subtraction.
 */
function evaluateExpression(
  expr: string,
  facts: Record<string, number | null>,
  missingInputs: string[],
): number | null {
  const tokens = tokenize(expr);

  if (tokens.length === 0) return null;

  // Single value
  if (tokens.length === 1) {
    return resolveValue(tokens[0], facts, missingInputs);
  }

  // Standard precedence: first pass handles * and /, second pass handles + and -
  // Build value/operator arrays
  const values: (number | null)[] = [];
  const ops: string[] = [];

  for (const token of tokens) {
    if (token.type === "op") {
      ops.push(token.op);
    } else {
      values.push(resolveValue(token, facts, missingInputs));
    }
  }

  // Sanity check
  if (values.length !== ops.length + 1) return null;

  // First pass: evaluate * and /
  const reducedValues: (number | null)[] = [values[0]];
  const reducedOps: string[] = [];

  for (let i = 0; i < ops.length; i++) {
    if (ops[i] === "*" || ops[i] === "/") {
      const left = reducedValues.pop()!;
      reducedValues.push(applyOp(left, ops[i], values[i + 1]));
    } else {
      reducedOps.push(ops[i]);
      reducedValues.push(values[i + 1]);
    }
  }

  // Second pass: evaluate + and - (left to right)
  let result = reducedValues[0];
  for (let i = 0; i < reducedOps.length; i++) {
    result = applyOp(result, reducedOps[i], reducedValues[i + 1]);
  }

  if (result !== null && !Number.isFinite(result)) return null;

  return result;
}

/**
 * Evaluate a metric by its registry ID.
 *
 * @param metricId - Key in METRIC_REGISTRY
 * @param facts - Map of fact keys to numeric values (null = missing)
 * @returns { value, missingInputs } — never throws, never returns NaN
 */
export function evaluateMetric(
  metricId: string,
  facts: Record<string, number | null>,
): EvalResult {
  const def = METRIC_REGISTRY[metricId];
  if (!def) {
    return { value: null, missingInputs: [`__UNKNOWN_METRIC:${metricId}`] };
  }

  return evaluateMetricDef(def, facts);
}

/**
 * Evaluate a metric from its definition directly (for callers who already have the def).
 */
export function evaluateMetricDef(
  def: MetricDefinition,
  facts: Record<string, number | null>,
): EvalResult {
  const missingInputs: string[] = [];
  const value = evaluateExpression(def.expr, facts, missingInputs);

  // Deduplicate missing inputs
  const uniqueMissing = [...new Set(missingInputs)];

  return { value, missingInputs: uniqueMissing };
}
