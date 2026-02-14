/**
 * Phase 13 — Registry Entry → MetricDefinition Mapper
 *
 * Bridges versioned registry entries (metric_registry_entries) to the
 * MetricDefinition type used by the metric graph evaluator.
 *
 * Dependency resolution rules (governance-safe):
 * 1. If definitionJson.dependsOn exists → use it (explicit, authoritative)
 * 2. If definitionJson.formula exists with string operands → extract non-numeric operands
 * 3. Only fallback to simple expr parsing if neither formula nor dependsOn present
 * 4. Never infer nested dependencies
 * 5. metricKey === def.key (strict equality, no renaming)
 */

import type { RegistryEntry } from "./types";
import type { MetricDefinition, FormulaNode, FormulaOp } from "@/lib/modelEngine/types";
import { loadVersionEntries } from "./selectActiveVersion";

// ---------------------------------------------------------------------------
// Formula resolution
// ---------------------------------------------------------------------------

const VALID_OPS: Record<string, FormulaOp> = {
  "/": "divide",
  "*": "multiply",
  "+": "add",
  "-": "subtract",
};

/**
 * Parse a simple binary expression like "A / B" into a FormulaNode.
 * Only used as last resort when no structured formula is provided.
 */
function parseSimpleExpr(expr: string): FormulaNode {
  for (const [op, formulaOp] of Object.entries(VALID_OPS)) {
    const parts = expr.split(` ${op} `);
    if (parts.length === 2) {
      return { type: formulaOp, left: parts[0].trim(), right: parts[1].trim() };
    }
  }
  throw new Error(`Cannot parse expression: "${expr}"`);
}

/**
 * Check if a string looks like a numeric literal (e.g. "100", "1.5", "0").
 */
function isNumericLiteral(s: string): boolean {
  return /^-?\d+(\.\d+)?$/.test(s);
}

/**
 * Extract dependency keys from a FormulaNode's left/right operands.
 * Non-numeric string operands are dependencies.
 */
function depsFromFormula(formula: FormulaNode): string[] {
  const deps: string[] = [];
  if (!isNumericLiteral(formula.left)) deps.push(formula.left);
  if (!isNumericLiteral(formula.right)) deps.push(formula.right);
  return deps;
}

// ---------------------------------------------------------------------------
// Entry → MetricDefinition conversion
// ---------------------------------------------------------------------------

/**
 * Convert a single RegistryEntry to a MetricDefinition.
 *
 * Key integrity: entry.metricKey === result.key (strict equality, no renaming).
 */
export function registryEntryToMetricDef(entry: RegistryEntry): MetricDefinition {
  const json = entry.definitionJson;
  const key = entry.metricKey;

  // 1. Resolve formula
  let formula: FormulaNode;
  if (json.formula && typeof json.formula === "object" && "type" in (json.formula as any)) {
    formula = json.formula as FormulaNode;
  } else if (typeof json.expr === "string") {
    console.warn(`[loadMetricDefs] Metric "${key}": using legacy expr parsing as fallback`);
    formula = parseSimpleExpr(json.expr as string);
  } else {
    throw new Error(`Metric "${key}": missing both formula and expr in definitionJson`);
  }

  // 2. Resolve dependencies
  let dependsOn: string[];
  if (Array.isArray(json.dependsOn)) {
    // Explicit dependsOn is authoritative
    dependsOn = json.dependsOn as string[];
  } else {
    // Extract from formula operands (non-numeric strings)
    dependsOn = depsFromFormula(formula);
  }

  return {
    id: entry.id,
    version: "versioned",
    key,
    dependsOn,
    formula,
    description: typeof json.description === "string" ? json.description : undefined,
    regulatoryReference: typeof json.regulatoryReference === "string" ? json.regulatoryReference : undefined,
  };
}

/**
 * Batch convert registry entries to MetricDefinitions.
 */
export function registryEntriesToMetricDefs(entries: RegistryEntry[]): MetricDefinition[] {
  return entries.map(registryEntryToMetricDef);
}

/**
 * Load MetricDefinitions for a specific registry version.
 */
export async function loadMetricDefsForVersion(
  supabase: any,
  versionId: string,
): Promise<MetricDefinition[]> {
  const entries = await loadVersionEntries(supabase, versionId);
  return registryEntriesToMetricDefs(entries);
}
