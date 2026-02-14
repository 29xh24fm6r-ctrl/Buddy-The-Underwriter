import "server-only";

import { STANDARD_ROWS, type StandardRow, type StandardStatement } from "@/lib/financialSpreads/standard/mapping";
import { STANDARD_FORMULAS } from "@/lib/financialSpreads/standard/formulas/registry";
import { evaluateMetric } from "@/lib/metrics/evaluateMetric";
import type { FinancialFact, RenderedSpread, RenderedSpreadCellV2, SpreadColumnV2 } from "@/lib/financialSpreads/types";

export type StandardRenderInput = {
  dealId: string;
  bankId: string;
  facts: FinancialFact[];
};

type PeriodBucket = {
  key: string;
  label: string;
  kind: "month" | "ytd" | "prior_ytd" | "ttm" | "other";
  start_date: string | null;
  end_date: string | null;
};

/**
 * Build a fact key → numeric value map from financial facts.
 * When multiple facts exist for the same key, picks the one with the latest period_end.
 * If a period_end is specified, only returns facts for that period.
 */
function buildFactsMap(
  facts: FinancialFact[],
  periodEnd?: string | null,
): Record<string, number | null> {
  const map: Record<string, number | null> = {};

  // Group by fact_key, pick latest period_end (or match specific period)
  const byKey = new Map<string, FinancialFact[]>();
  for (const f of facts) {
    if (f.fact_value_num === null && f.fact_value_text === null) continue;
    const k = f.fact_key;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(f);
  }

  for (const [key, group] of byKey) {
    let best: FinancialFact | null = null;
    for (const f of group) {
      if (periodEnd && f.fact_period_end !== periodEnd) continue;
      if (!best || (f.fact_period_end ?? "") > (best.fact_period_end ?? "")) {
        best = f;
      }
    }
    if (best) {
      map[key] = best.fact_value_num;
    }
  }

  return map;
}

/** Sentinel dates used as placeholders when real period is unknown. */
const SENTINEL_DATES = new Set(["1900-01-01", "0001-01-01"]);

/**
 * Detect distinct periods from facts (for multi-period columns).
 * Filters out sentinel dates that represent "unknown period".
 */
function detectPeriods(facts: FinancialFact[]): PeriodBucket[] {
  const periodEnds = new Set<string>();
  for (const f of facts) {
    if (f.fact_period_end && !SENTINEL_DATES.has(f.fact_period_end)) {
      periodEnds.add(f.fact_period_end);
    }
  }

  const sorted = [...periodEnds].sort();
  if (sorted.length <= 1) {
    // Single period or no periods — use one "Current" column
    return [{
      key: "CURRENT",
      label: "Current",
      kind: "other",
      start_date: null,
      end_date: sorted[0] ?? null,
    }];
  }

  // Multi-period: create a column per distinct period_end
  return sorted.map((pe) => ({
    key: pe,
    label: formatPeriodLabel(pe),
    kind: "other" as const,
    start_date: null,
    end_date: pe,
  }));
}

function formatPeriodLabel(periodEnd: string): string {
  // Try to parse YYYY-MM-DD → "Dec 2024"
  const m = periodEnd.match(/^(\d{4})-(\d{2})/);
  if (!m) return periodEnd;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthIdx = Number(m[2]) - 1;
  return `${months[monthIdx] ?? m[2]} ${m[1]}`;
}

/**
 * Evaluate a formula by its ID. For formulas with a metricRegistryId, delegates to
 * the centralized evaluateMetric(). For structural formulas (metricRegistryId: null),
 * evaluates the expression directly using the facts map.
 */
function evaluateFormula(
  formulaId: string,
  factsMap: Record<string, number | null>,
): number | null {
  const formula = STANDARD_FORMULAS[formulaId];
  if (!formula) return null;

  if (formula.metricRegistryId) {
    const result = evaluateMetric(formula.metricRegistryId, factsMap);
    return result.value;
  }

  // Structural formula: evaluate expression directly using the same safe evaluator
  // Import would create circular dep, so we use a simple inline evaluation
  return evaluateStructuralExpr(formula.expr, factsMap);
}

/**
 * Simple structural expression evaluator for sums like
 * "A + B + C" or "A - B". No nested formulas.
 */
function evaluateStructuralExpr(
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
      // For sums, skip null terms (treat as 0) — but if ALL are null, return null
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

/**
 * Render the Financial Analysis (standard spread) package.
 *
 * Returns a RenderedSpread-compatible structure with multi-period support.
 */
export function renderStandardSpread(input: StandardRenderInput): RenderedSpread {
  const generatedAt = new Date().toISOString();
  const periods = detectPeriods(input.facts);

  // Build per-period fact maps
  const periodFactMaps = new Map<string, Record<string, number | null>>();
  for (const p of periods) {
    periodFactMaps.set(p.key, buildFactsMap(input.facts, p.end_date));
  }

  // Also build a "latest" map for single-value lookups
  const latestFacts = buildFactsMap(input.facts);

  // Sort rows by (statement order within groups, then row order)
  const STATEMENT_ORDER: Record<StandardStatement, number> = {
    BALANCE_SHEET: 1,
    INCOME_STATEMENT: 2,
    CASH_FLOW: 3,
    RATIOS: 4,
    EXEC_SUMMARY: 5,
  };

  const sortedRows = [...STANDARD_ROWS].sort((a, b) => {
    const stmtDiff = (STATEMENT_ORDER[a.statement] ?? 99) - (STATEMENT_ORDER[b.statement] ?? 99);
    if (stmtDiff !== 0) return stmtDiff;
    return a.order - b.order;
  });

  // Build columns
  const columnsV2: SpreadColumnV2[] = periods.map((p) => ({
    key: p.key,
    label: p.label,
    kind: p.kind,
    start_date: p.start_date,
    end_date: p.end_date,
  }));

  // Build rows
  const rows: RenderedSpread["rows"] = [];
  let lastStatement: StandardStatement | null = null;

  for (const row of sortedRows) {
    // Add statement header when statement changes
    if (row.statement !== lastStatement) {
      rows.push({
        key: `_header_${row.statement}`,
        label: formatStatementLabel(row.statement),
        section: row.statement,
        values: [],
        notes: "section_header",
      });
      lastStatement = row.statement;
    }

    const valueByCol: Record<string, string | number | null> = {};
    const displayByCol: Record<string, string | null> = {};

    for (const period of periods) {
      const factsMap = periodFactMaps.get(period.key) ?? latestFacts;

      // Merge computed values back into factsMap for cascading formulas
      // (e.g., TOTAL_CURRENT_ASSETS used by TOTAL_ASSETS)
      const enrichedFacts = { ...factsMap };
      // Pre-compute structural subtotals that other formulas depend on
      for (const dep of sortedRows) {
        if (dep.formulaId && dep.order < row.order && dep.statement === row.statement) {
          const depVal = evaluateFormula(dep.formulaId, enrichedFacts);
          if (depVal !== null) enrichedFacts[dep.key] = depVal;
        }
      }

      let value: number | null = null;

      if (row.formulaId) {
        value = evaluateFormula(row.formulaId, enrichedFacts);
      } else {
        value = enrichedFacts[row.key] ?? null;
      }

      valueByCol[period.key] = value;

      // Format display value
      if (value !== null) {
        const precision = row.precision ?? 0;
        let formatted: string;
        if (row.isPercent) {
          formatted = (value * 100).toFixed(Math.max(0, precision - 2)) + "%";
        } else if (precision > 0) {
          formatted = value.toFixed(precision);
        } else {
          formatted = Math.round(value).toLocaleString("en-US");
        }
        if (row.sign === "PAREN_NEGATIVE" && value < 0) {
          formatted = `(${Math.abs(value).toLocaleString("en-US")})`;
        }
        displayByCol[period.key] = formatted;
      } else {
        displayByCol[period.key] = "—";
      }
    }

    const cell: RenderedSpreadCellV2 = {
      value: valueByCol[periods[0]?.key] ?? null,
      valueByCol,
      displayByCol,
      formula_ref: row.formulaId ?? null,
    };

    rows.push({
      key: row.key,
      label: row.label,
      section: row.section,
      values: [cell],
      formula: row.formulaId ?? null,
    });
  }

  return {
    schema_version: 3,
    title: "Financial Analysis",
    spread_type: "STANDARD",
    status: "ready",
    generatedAt,
    asOf: null,
    columns: periods.map((p) => p.label),
    columnsV2,
    rows,
    meta: {
      template: "standard",
      version: 1,
      row_count: STANDARD_ROWS.length,
      period_count: periods.length,
    },
  };
}

/**
 * Render with snapshot validation.
 *
 * Always renders the full spread — validation issues are informational,
 * not render-blocking. Users should see extracted financial data even when
 * pricing-derived metrics (dscr, ltv, etc.) are not yet computed.
 */
export function renderStandardSpreadWithValidation(
  input: StandardRenderInput & {
    snapshot?: import("@/lib/deals/financialSnapshotCore").DealFinancialSnapshotV1 | null;
  },
): RenderedSpread & { validation?: import("@/lib/metrics/validateSnapshot").ValidationResult } {
  // Validation requires a snapshot; if not provided, render without validation
  if (!input.snapshot) {
    return renderStandardSpread(input);
  }

  // Lazy import to keep validation optional
  const { validateSnapshotForRender, inferBusinessModel } = require("@/lib/metrics/validateSnapshot") as typeof import("@/lib/metrics/validateSnapshot");

  const businessModel = inferBusinessModel(input.snapshot);
  const validation = validateSnapshotForRender(input.snapshot, businessModel);

  // Always render the full spread with all available data
  const spread = renderStandardSpread(input);

  spread.meta = {
    ...spread.meta,
    business_model: businessModel,
    ...(validation.errors.length > 0 ? { validation_errors: validation.errors } : {}),
    ...(validation.warnings.length > 0 ? { validation_warnings: validation.warnings } : {}),
  };

  return { ...spread, validation };
}

function formatStatementLabel(statement: StandardStatement): string {
  switch (statement) {
    case "BALANCE_SHEET": return "Balance Sheet";
    case "INCOME_STATEMENT": return "Income Statement";
    case "CASH_FLOW": return "Cash Flow Analysis";
    case "RATIOS": return "Financial Ratios";
    case "EXEC_SUMMARY": return "Executive Summary";
    default: return statement;
  }
}
