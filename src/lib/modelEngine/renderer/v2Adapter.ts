/**
 * Model Engine — Authoritative Adapter
 *
 * Converts FinancialModel → SpreadViewModel using the standard row mapping.
 * Reads from FinancialModel.periods (income/balance/cashflow),
 * evaluates formulas through the same standard formula registry,
 * and produces the renderer-neutral SpreadViewModel.
 *
 * Phase 10: V2 is the authoritative computation engine.
 */

import { STANDARD_ROWS, type StandardRow, type StandardStatement } from "@/lib/financialSpreads/standard/mapping";
import { classifyRowKind } from "@/lib/financialSpreads/standard/classifyRowKind";
import type { FinancialModel, FinancialPeriod } from "../types";
import type { SpreadViewColumn, SpreadViewRow, SpreadViewSection, SpreadViewModel } from "./types";
import { evaluateStandardFormula, formatStandardValue } from "./formulaEval";
import { evaluateMetric } from "@/lib/metrics/evaluateMetric";

/** Helper metrics pre-computed before ratio evaluation. */
const HELPER_METRIC_IDS = ["QUICK_ASSETS", "FIXED_CHARGES", "EBIT"];

// ---------------------------------------------------------------------------
// Reverse mapping: FinancialPeriod field → standard fact key
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Fact key aliases — bridge mapping.ts row keys → V2 model field keys.
// Same aliases as renderStandardSpread.ts for consistency.
// ---------------------------------------------------------------------------

const FACT_KEY_ALIASES: Record<string, string[]> = {
  // IS aliases per MMAS — OBI is net income, never revenue
  TOTAL_REVENUE: ["GROSS_RECEIPTS", "TOTAL_INCOME"],
  COST_OF_GOODS_SOLD: ["COGS"],
  NET_PROFIT: ["NET_INCOME", "ORDINARY_BUSINESS_INCOME", "TAXABLE_INCOME", "ADJUSTED_GROSS_INCOME"],
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

/** When a row is computed, also store under these legacy keys for metric compat. */
const ROW_KEY_EMIT_ALIASES: Record<string, string[]> = {
  NET_PROFIT: ["NET_INCOME"],
};

/**
 * Apply aliases: inject mapping-row keys from alternative fact keys.
 * Only fills if the mapping key is not already present (direct value wins).
 */
function applyAliases(map: Record<string, number | null>): void {
  for (const [alias, sources] of Object.entries(FACT_KEY_ALIASES)) {
    if (map[alias] !== undefined) continue;
    for (const src of sources) {
      if (map[src] !== undefined) {
        map[alias] = map[src];
        break;
      }
    }
  }
}

/**
 * Flatten a FinancialPeriod into a Record<string, number | null> keyed by
 * standard fact keys. This is the reverse of buildFinancialModel's
 * INCOME_MAP / BALANCE_MAP / CASHFLOW_MAP.
 */
function periodToFactMap(period: FinancialPeriod): Record<string, number | null> {
  const map: Record<string, number | null> = {};

  // Income → standard keys (MMAS-native keys)
  if (period.income.revenue !== undefined) map["TOTAL_REVENUE"] = period.income.revenue;
  if (period.income.cogs !== undefined) map["COST_OF_GOODS_SOLD"] = period.income.cogs;
  if (period.income.operatingExpenses !== undefined) map["TOTAL_OPERATING_EXPENSES"] = period.income.operatingExpenses;
  if (period.income.depreciation !== undefined) map["DEPRECIATION"] = period.income.depreciation;
  if (period.income.interest !== undefined) {
    map["INTEREST_EXPENSE"] = period.income.interest;
    map["DEBT_SERVICE"] = period.income.interest; // alias for CRE templates
  }
  if (period.income.netIncome !== undefined) map["NET_INCOME"] = period.income.netIncome;

  // Balance → standard keys
  if (period.balance.cash !== undefined) map["CASH_AND_EQUIVALENTS"] = period.balance.cash;
  if (period.balance.accountsReceivable !== undefined) map["ACCOUNTS_RECEIVABLE"] = period.balance.accountsReceivable;
  if (period.balance.inventory !== undefined) map["INVENTORY"] = period.balance.inventory;
  if (period.balance.totalAssets !== undefined) map["TOTAL_ASSETS"] = period.balance.totalAssets;
  if (period.balance.shortTermDebt !== undefined) map["ST_LOANS_PAYABLE"] = period.balance.shortTermDebt;
  if (period.balance.longTermDebt !== undefined) map["LONG_TERM_DEBT"] = period.balance.longTermDebt;
  if (period.balance.totalLiabilities !== undefined) map["TOTAL_LIABILITIES"] = period.balance.totalLiabilities;
  if (period.balance.equity !== undefined) map["NET_WORTH"] = period.balance.equity;

  // Cashflow → standard keys
  if (period.cashflow.ebitda !== undefined) map["EBITDA"] = period.cashflow.ebitda;
  if (period.cashflow.capex !== undefined) map["CAPITAL_EXPENDITURES"] = period.cashflow.capex;
  if (period.cashflow.cfads !== undefined) map["CASH_FLOW_AVAILABLE"] = period.cashflow.cfads;

  // Apply aliases so MMAS row keys match V2 model field keys
  applyAliases(map);

  return map;
}

// ---------------------------------------------------------------------------
// Statement ordering (same as renderStandardSpread)
// ---------------------------------------------------------------------------

const STATEMENT_ORDER: Record<StandardStatement, number> = {
  BALANCE_SHEET: 1,
  INCOME_STATEMENT: 2,
  CASH_FLOW: 3,
  RATIOS: 4,
  EXEC_SUMMARY: 5,
};

const STATEMENT_LABELS: Record<StandardStatement, string> = {
  BALANCE_SHEET: "Balance Sheet",
  INCOME_STATEMENT: "Income Statement",
  CASH_FLOW: "Cash Flow Analysis",
  RATIOS: "Financial Ratios",
  EXEC_SUMMARY: "Executive Summary",
};

// ---------------------------------------------------------------------------
// Period label formatting (same as renderStandardSpread)
// ---------------------------------------------------------------------------

function formatPeriodLabel(periodEnd: string): string {
  const m = periodEnd.match(/^(\d{4})-(\d{2})/);
  if (!m) return periodEnd;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthIdx = Number(m[2]) - 1;
  return `${months[monthIdx] ?? m[2]} ${m[1]}`;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Convert a FinancialModel into a SpreadViewModel.
 *
 * @param model - FinancialModel from buildFinancialModel()
 * @param dealId - Deal ID (for traceability — model.dealId is the canonical source)
 */
export function renderFromFinancialModel(
  model: FinancialModel,
  dealId?: string,
): SpreadViewModel {
  const effectiveDealId = dealId ?? model.dealId;
  const generatedAt = new Date().toISOString();

  // Build columns from model periods (sorted ascending by periodEnd)
  const sortedPeriods = [...model.periods].sort((a, b) =>
    a.periodEnd.localeCompare(b.periodEnd),
  );

  const columns: SpreadViewColumn[] = sortedPeriods.map((p) => ({
    key: p.periodEnd,
    label: formatPeriodLabel(p.periodEnd),
    kind: "other",
  }));

  // Build per-period fact maps
  const periodFactMaps = new Map<string, Record<string, number | null>>();
  for (const p of sortedPeriods) {
    periodFactMaps.set(p.periodEnd, periodToFactMap(p));
  }

  // Sort rows by statement order, then row order (same as renderStandardSpread)
  const sortedRows = [...STANDARD_ROWS].sort((a, b) => {
    const stmtDiff = (STATEMENT_ORDER[a.statement] ?? 99) - (STATEMENT_ORDER[b.statement] ?? 99);
    if (stmtDiff !== 0) return stmtDiff;
    return a.order - b.order;
  });

  // Global per-period accumulator — enables cross-statement cascading.
  // Ratios can reference computed IS/BS values (GROSS_PROFIT, NET_OPERATING_PROFIT, etc.)
  const globalComputed = new Map<string, Record<string, number | null>>();
  for (const p of sortedPeriods) globalComputed.set(p.periodEnd, {});

  // Group rows into sections by statement
  const sectionMap = new Map<StandardStatement, SpreadViewRow[]>();
  let nonNullCellCount = 0;

  for (const row of sortedRows) {
    if (!sectionMap.has(row.statement)) {
      sectionMap.set(row.statement, []);
    }

    const valueByCol: Record<string, number | null> = {};
    const displayByCol: Record<string, string | null> = {};

    for (const period of sortedPeriods) {
      const factsMap = periodFactMaps.get(period.periodEnd) ?? {};

      // Merge raw facts + all previously computed values (cross-statement)
      const enrichedFacts = { ...factsMap, ...globalComputed.get(period.periodEnd)! };

      // Pre-compute helper metrics needed by ratio formulas
      for (const hid of HELPER_METRIC_IDS) {
        if (enrichedFacts[hid] === undefined) {
          const hr = evaluateMetric(hid, enrichedFacts);
          if (hr.value !== null) enrichedFacts[hid] = hr.value;
        }
      }

      let value: number | null = null;

      if (row.formulaId) {
        value = evaluateStandardFormula(row.formulaId, enrichedFacts);
      }
      // Fallback: if formula returned null or no formula, try direct fact lookup
      if (value === null) {
        value = enrichedFacts[row.key] ?? null;
      }

      // Store in global accumulator for downstream formulas
      if (value !== null) {
        globalComputed.get(period.periodEnd)![row.key] = value;
        // Emit aliases so legacy metric references still resolve
        for (const alias of ROW_KEY_EMIT_ALIASES[row.key] ?? []) {
          if (globalComputed.get(period.periodEnd)![alias] === undefined) {
            globalComputed.get(period.periodEnd)![alias] = value;
          }
        }
      }

      valueByCol[period.periodEnd] = value;
      displayByCol[period.periodEnd] = formatStandardValue(value, row);

      if (value !== null) nonNullCellCount++;
    }

    const viewRow: SpreadViewRow = {
      key: row.key,
      label: row.label,
      section: row.section,
      kind: classifyRowKind({ key: row.key, formula: row.formulaId ?? null, section: row.section }),
      valueByCol,
      displayByCol,
      formulaId: row.formulaId ?? null,
    };

    sectionMap.get(row.statement)!.push(viewRow);
  }

  // Build sections in statement order
  const statementOrder: StandardStatement[] = [
    "BALANCE_SHEET",
    "INCOME_STATEMENT",
    "CASH_FLOW",
    "RATIOS",
    "EXEC_SUMMARY",
  ];

  const sections: SpreadViewSection[] = [];
  for (const stmt of statementOrder) {
    const rows = sectionMap.get(stmt);
    if (rows && rows.length > 0) {
      sections.push({
        key: stmt,
        label: STATEMENT_LABELS[stmt],
        rows,
      });
    }
  }

  const rowCount = sections.reduce((sum, s) => sum + s.rows.length, 0);

  return {
    source: "v2_model",
    dealId: effectiveDealId,
    generatedAt,
    columns,
    sections,
    meta: {
      rowCount,
      sectionCount: sections.length,
      periodCount: columns.length,
      nonNullCellCount,
    },
  };
}
