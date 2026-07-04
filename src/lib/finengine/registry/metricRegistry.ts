/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 1: Finengine Registry Consolidation.
 *
 * Canonical METRIC surface for the finengine. This module owns NO formulas of
 * its own — it re-exports the single authoritative `METRIC_REGISTRY`
 * (`src/lib/metrics/registry.ts`) and adds pure, read-only consolidation
 * helpers on top of it (id set, typed accessor, dependency graph). Keeping the
 * finengine's canonical view as a thin re-export is the load-bearing guarantee
 * against "duplicated formula systems" (safety rule 5): there is exactly one
 * place a formula string can live, and it is the central registry.
 *
 * Pure + standalone (no server-only imports) so it is unit-testable under
 * `node --test --import tsx`.
 */

import {
  METRIC_REGISTRY,
  METRIC_REGISTRY_VERSION,
  type MetricDefinition,
  type BusinessModel,
} from "@/lib/metrics/registry";

export { METRIC_REGISTRY, METRIC_REGISTRY_VERSION };
export type { MetricDefinition, BusinessModel };

/** Every canonical metric id the engine owns and can evaluate. */
export const CANONICAL_METRIC_IDS: ReadonlySet<string> = new Set(
  Object.keys(METRIC_REGISTRY),
);

/** Typed accessor — returns null (never throws) for an unknown id. */
export function getMetricDefinition(id: string): MetricDefinition | null {
  return METRIC_REGISTRY[id] ?? null;
}

/** Is `id` a canonical metric the central registry defines? */
export function isCanonicalMetric(id: string): boolean {
  return CANONICAL_METRIC_IDS.has(id);
}

/**
 * The identifier grammar the shared evaluator (`evaluateMetric.ts::tokenize`)
 * uses for a fact/metric reference. Kept byte-identical so the dependency graph
 * we derive here matches what actually gets evaluated. If the evaluator's
 * grammar changes, this must change with it (a drift test guards the pair).
 */
export const METRIC_TOKEN_RE = /^[A-Z][A-Z0-9_]*$/;

/**
 * Direct dependencies of a metric = the UPPER_SNAKE identifiers appearing in its
 * `expr`, in first-seen order, de-duplicated. Numeric literals and operators are
 * excluded. A dependency may itself be a canonical metric (a nested formula) or a
 * raw fact key (a leaf input) — use {@link classifyDependency} to tell them apart.
 */
export function metricDependencies(id: string): string[] {
  const def = METRIC_REGISTRY[id];
  if (!def) return [];
  return exprIdentifiers(def.expr);
}

/** Extract the ordered, de-duplicated identifier tokens from an expression. */
export function exprIdentifiers(expr: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of expr.split(/\s+/).filter(Boolean)) {
    if (part === "+" || part === "-" || part === "*" || part === "/") continue;
    if (/^-?\d+(\.\d+)?$/.test(part)) continue;
    if (!METRIC_TOKEN_RE.test(part)) continue;
    if (!seen.has(part)) {
      seen.add(part);
      out.push(part);
    }
  }
  return out;
}

export type DependencyKind = "metric" | "fact";

/** A dependency is a `metric` if the central registry defines it, else a `fact` leaf. */
export function classifyDependency(token: string): DependencyKind {
  return CANONICAL_METRIC_IDS.has(token) ? "metric" : "fact";
}

/**
 * Full formula dependency graph: metricId → its direct dependency ids. Pure and
 * derived from `expr` at call time (no caching, so it always reflects the live
 * registry). Consumers that need the transitive closure or the raw fact leaves
 * can walk this with {@link classifyDependency}.
 */
export function buildFormulaDependencyGraph(): Record<string, string[]> {
  const graph: Record<string, string[]> = {};
  for (const id of Object.keys(METRIC_REGISTRY)) {
    graph[id] = metricDependencies(id);
  }
  return graph;
}

/** The raw fact-key leaves a metric ultimately reads (transitive, metric deps expanded). */
export function transitiveFactLeaves(id: string, _seen = new Set<string>()): string[] {
  if (_seen.has(id)) return []; // cycle guard
  _seen.add(id);
  const leaves = new Set<string>();
  for (const dep of metricDependencies(id)) {
    if (classifyDependency(dep) === "metric") {
      for (const leaf of transitiveFactLeaves(dep, _seen)) leaves.add(leaf);
    } else {
      leaves.add(dep);
    }
  }
  return [...leaves];
}

/**
 * NULL-HANDLING POLICY (documented, not re-implemented).
 *
 * The single evaluation path is `evaluateMetric()`. Its contract, which the
 * finengine adopts verbatim:
 *   - Any null/undefined operand → null result (null propagation).
 *   - Divide-by-zero → null (never Infinity).
 *   - A non-finite intermediate (NaN/Infinity) → null.
 *   - Missing inputs are reported in `missingInputs`, never silently zeroed.
 * A metric therefore returns a number only when every required fact is present
 * and the arithmetic is finite; otherwise it is `null` (unknown), never `0`.
 */
export const NULL_HANDLING_POLICY = {
  nullOperandPropagates: true,
  divideByZeroYieldsNull: true,
  nonFiniteYieldsNull: true,
  missingInputsReportedNotZeroed: true,
} as const;
