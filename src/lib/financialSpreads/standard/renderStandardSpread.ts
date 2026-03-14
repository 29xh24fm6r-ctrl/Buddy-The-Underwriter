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

// ---------------------------------------------------------------------------
// Fact key aliases — bridge mapping.ts row keys → extractor-written fact keys.
// When buildFactsMap finds no fact for a mapping row key, it tries these
// sources in priority order (first found wins).
// ---------------------------------------------------------------------------

// Keys where null/missing should be treated as 0 (IRS nullAsZero fields).
// Service businesses have no COGS; entities without debt have no interest.
const NULL_AS_ZERO_KEYS = [
  "COST_OF_GOODS_SOLD",
  "INTEREST_EXPENSE",
  "DEPRECIATION",
];

const FACT_KEY_ALIASES: Record<string, string[]> = {
  // IS aliases per MMAS — OBI is net income, never revenue
  TOTAL_REVENUE: ["GROSS_RECEIPTS", "TOTAL_INCOME"],
  COST_OF_GOODS_SOLD: ["COGS"],
  NET_PROFIT: ["NET_INCOME", "ORDINARY_BUSINESS_INCOME", "TAXABLE_INCOME", "ADJUSTED_GROSS_INCOME"],
  NET_OPERATING_PROFIT: ["OPERATING_INCOME", "ORDINARY_BUSINESS_INCOME"],
  OFFICER_COMPENSATION: ["OFFICERS_COMPENSATION", "SALARIES_WAGES"],
  DEPRECIATION: ["AMORTIZATION", "DEPRECIATION_AMORTIZATION"],
  TOTAL_OPERATING_EXPENSES: ["TOTAL_DEDUCTIONS", "TOTAL_OPEX"],
  INTEREST_EXPENSE: ["DEBT_SERVICE"],
  OTHER_DEDUCTIONS: ["OTHER_OPEX"],
  OPERATING_EXPENSE: ["SELLING_GENERAL_ADMIN"],
  // BS aliases
  FIXED_ASSETS_NET: ["NET_FIXED_ASSETS", "PROPERTY_PLANT_EQUIPMENT"],
  ST_LOANS_PAYABLE: ["SHORT_TERM_DEBT", "CURRENT_PORTION_LTD"],
  ACCRUED_LIABILITIES: ["ACCRUED_EXPENSES"],
  INTANGIBLES_NET: ["INTANGIBLE_ASSETS"],
};

/**
 * Helper metrics that must be pre-computed before ratio formulas can evaluate.
 * These intermediate values aren't visible rows but are needed as formula inputs.
 */
const HELPER_METRIC_IDS = ["QUICK_ASSETS", "FIXED_CHARGES", "EBIT"];

/**
 * When a row is computed, also store its value under these legacy keys
 * so downstream metric formulas (which reference the old key) still resolve.
 */
const ROW_KEY_EMIT_ALIASES: Record<string, string[]> = {
  NET_PROFIT: ["NET_INCOME"],
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

  // Group by fact_key, pick latest period_end (or match specific period).
  // When duplicates exist for the same key+period (different source docs),
  // prefer highest confidence.
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
      if (!best) {
        best = f;
      } else if ((f.fact_period_end ?? "") > (best.fact_period_end ?? "")) {
        // Later period wins
        best = f;
      } else if (
        f.fact_period_end === best.fact_period_end &&
        (f.confidence ?? 0) > (best.confidence ?? 0)
      ) {
        // Same period — higher confidence wins
        best = f;
      }
    }
    if (best) {
      map[key] = best.fact_value_num;
    }
  }

  // Apply aliases: inject mapping-row keys from extractor-written fact keys.
  // Only fills if the mapping key is not already present (direct fact wins).
  for (const [alias, sources] of Object.entries(FACT_KEY_ALIASES)) {
    if (map[alias] !== undefined) continue;
    for (const src of sources) {
      if (map[src] !== undefined) {
        map[alias] = map[src];
        break;
      }
    }
  }

  // Null-as-zero: IRS fields that should default to 0 when missing.
  // Service businesses have no COGS; entities without debt have no interest.
  for (const key of NULL_AS_ZERO_KEYS) {
    if (map[key] === undefined) map[key] = 0;
  }

  return map;
}

/** Sentinel dates used as placeholders when real period is unknown. */
const SENTINEL_DATES = new Set(["1900-01-01", "0001-01-01"]);

/** Fact types that confirm a full fiscal year period. */
const FULL_YEAR_FACT_TYPES = new Set([
  "TAX_RETURN",
  "PERSONAL_INCOME",
]);

/**
 * Detect distinct periods from facts (for multi-period columns).
 * Filters out sentinel dates that represent "unknown period".
 *
 * Column labels reflect period certainty:
 *   - Tax returns / personal income → "FY YYYY" (confirmed full fiscal year)
 *   - IS/BS/PFS ending Dec 31 (docYear fallback) → "YTD YYYY" (period may be partial)
 *   - Specific non-Dec-31 dates → "Mon YYYY" (clearly dated)
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

  // Build fact-type set per period for label classification
  const factTypesByPeriod = new Map<string, Set<string>>();
  for (const f of facts) {
    if (f.fact_period_end && !SENTINEL_DATES.has(f.fact_period_end)) {
      if (!factTypesByPeriod.has(f.fact_period_end)) {
        factTypesByPeriod.set(f.fact_period_end, new Set());
      }
      factTypesByPeriod.get(f.fact_period_end)!.add(f.fact_type);
    }
  }

  // Multi-period: create a column per distinct period_end
  return sorted.map((pe) => ({
    key: pe,
    label: formatPeriodLabel(pe, factTypesByPeriod.get(pe)),
    kind: "other" as const,
    start_date: null,
    end_date: pe,
  }));
}

function formatPeriodLabel(periodEnd: string, factTypes?: Set<string>): string {
  const m = periodEnd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return periodEnd;

  const year = m[1];
  const month = Number(m[2]);
  const day = Number(m[3]);

  // Check if any fact in this period confirms a full fiscal year
  const hasFullYear = factTypes
    ? [...factTypes].some((ft) => FULL_YEAR_FACT_TYPES.has(ft))
    : false;

  // Dec 31 ending → either "FY YYYY" or "YTD YYYY" depending on fact types
  if (month === 12 && day === 31) {
    return hasFullYear ? `FY ${year}` : `YTD ${year}`;
  }

  // Non-Dec-31 dates → "Mon YYYY" (clearly a specific statement date)
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[month - 1] ?? m[2]} ${year}`;
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

  // Global per-period accumulator — enables cross-statement cascading.
  // Ratios can reference computed IS/BS values (GROSS_PROFIT, NET_OPERATING_PROFIT, etc.)
  const globalComputed = new Map<string, Record<string, number | null>>();
  for (const p of periods) globalComputed.set(p.key, {});

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

      // Merge raw facts + all previously computed values (cross-statement)
      const enrichedFacts = { ...factsMap, ...globalComputed.get(period.key)! };

      // Pre-compute helper metrics needed by ratio formulas (QUICK_ASSETS, FIXED_CHARGES, EBIT)
      for (const hid of HELPER_METRIC_IDS) {
        if (enrichedFacts[hid] === undefined) {
          const hr = evaluateMetric(hid, enrichedFacts);
          if (hr.value !== null) enrichedFacts[hid] = hr.value;
        }
      }

      let value: number | null = null;

      if (row.formulaId) {
        value = evaluateFormula(row.formulaId, enrichedFacts);
      }
      // Fallback: if formula returned null (missing inputs) or no formula,
      // try direct fact/alias lookup. This lets aggregate facts like
      // TOTAL_OPERATING_EXPENSES populate when individual line items are absent.
      if (value === null) {
        value = enrichedFacts[row.key] ?? null;
      }

      // Store computed value in global accumulator for downstream formulas
      if (value !== null) {
        globalComputed.get(period.key)![row.key] = value;
        // Emit aliases so legacy metric references (e.g. NET_INCOME) still resolve
        for (const alias of ROW_KEY_EMIT_ALIASES[row.key] ?? []) {
          if (globalComputed.get(period.key)![alias] === undefined) {
            globalComputed.get(period.key)![alias] = value;
          }
        }
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
