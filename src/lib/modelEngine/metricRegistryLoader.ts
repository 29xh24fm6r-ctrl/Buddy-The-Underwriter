/**
 * Model Engine V2 — Metric Registry Loader
 *
 * Loads metric definitions from the database (metric_definitions table).
 * Falls back to built-in V1 seed definitions when DB is empty.
 *
 * No eval(). Formulas are structured JSON evaluated by metricGraph.ts.
 */

import type { MetricDefinition, FormulaNode } from "./types";

// ---------------------------------------------------------------------------
// V1 seed definitions (used when DB has no definitions for requested version)
// ---------------------------------------------------------------------------

const V1_SEED: MetricDefinition[] = [
  {
    id: "seed-dscr",
    version: "v1",
    key: "DSCR",
    dependsOn: ["CFADS", "DEBT_SERVICE"],
    formula: { type: "divide", left: "CFADS", right: "DEBT_SERVICE" },
    description: "Debt Service Coverage Ratio",
    regulatoryReference: "OCC 2020-32",
  },
  {
    id: "seed-leverage",
    version: "v1",
    key: "LEVERAGE",
    dependsOn: ["TOTAL_DEBT", "EBITDA"],
    formula: { type: "divide", left: "TOTAL_DEBT", right: "EBITDA" },
    description: "Leverage Ratio (Total Debt / EBITDA)",
  },
  {
    id: "seed-current-ratio",
    version: "v1",
    key: "CURRENT_RATIO",
    dependsOn: ["CURRENT_ASSETS", "CURRENT_LIABILITIES"],
    formula: { type: "divide", left: "CURRENT_ASSETS", right: "CURRENT_LIABILITIES" },
    description: "Current Ratio",
  },
  {
    id: "seed-debt-to-equity",
    version: "v1",
    key: "DEBT_TO_EQUITY",
    dependsOn: ["TOTAL_DEBT", "EQUITY"],
    formula: { type: "divide", left: "TOTAL_DEBT", right: "EQUITY" },
    description: "Debt-to-Equity Ratio",
  },
  {
    id: "seed-gross-margin",
    version: "v1",
    key: "GROSS_MARGIN",
    dependsOn: ["GROSS_PROFIT", "REVENUE"],
    formula: { type: "divide", left: "GROSS_PROFIT", right: "REVENUE" },
    description: "Gross Margin (%)",
  },
  {
    id: "seed-net-margin",
    version: "v1",
    key: "NET_MARGIN",
    dependsOn: ["NET_INCOME", "REVENUE"],
    formula: { type: "divide", left: "NET_INCOME", right: "REVENUE" },
    description: "Net Income Margin (%)",
  },
  {
    id: "seed-roa",
    version: "v1",
    key: "ROA",
    dependsOn: ["NET_INCOME", "TOTAL_ASSETS"],
    formula: { type: "divide", left: "NET_INCOME", right: "TOTAL_ASSETS" },
    description: "Return on Assets",
  },
];

// ---------------------------------------------------------------------------
// DB row → MetricDefinition mapper
// ---------------------------------------------------------------------------

interface DbMetricRow {
  id: string;
  version: string;
  key: string;
  depends_on: string[];
  formula: FormulaNode;
  description?: string;
  regulatory_reference?: string;
}

function rowToDefinition(row: DbMetricRow): MetricDefinition {
  return {
    id: row.id,
    version: row.version,
    key: row.key,
    dependsOn: Array.isArray(row.depends_on) ? row.depends_on : [],
    formula: row.formula,
    description: row.description ?? undefined,
    regulatoryReference: row.regulatory_reference ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Load metric definitions from the database for a given version.
 * Falls back to V1 seed if no DB definitions found.
 *
 * @param supabase - Supabase admin client
 * @param version - Registry version to load (default: "v1")
 */
export async function loadMetricRegistry(
  supabase: any,
  version: string = "v1",
): Promise<MetricDefinition[]> {
  const { data, error } = await supabase
    .from("metric_definitions")
    .select("id, version, key, depends_on, formula, description, regulatory_reference")
    .eq("version", version)
    .order("key");

  if (error) {
    console.warn("[metricRegistryLoader] DB load failed, using seed:", error.message);
    return V1_SEED;
  }

  if (!data || data.length === 0) {
    return V1_SEED;
  }

  return (data as DbMetricRow[]).map(rowToDefinition);
}

/**
 * Get the V1 seed definitions (no DB required).
 * Useful for testing and offline evaluation.
 */
export function getV1SeedDefinitions(): MetricDefinition[] {
  return [...V1_SEED];
}
