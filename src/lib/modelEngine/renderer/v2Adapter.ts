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
import { classifyRowKind } from "@/components/deals/spreads/SpreadTable";
import type { FinancialModel, FinancialPeriod } from "../types";
import type { SpreadViewColumn, SpreadViewRow, SpreadViewSection, SpreadViewModel } from "./types";
import { evaluateStandardFormula, formatStandardValue } from "./formulaEval";

// ---------------------------------------------------------------------------
// Reverse mapping: FinancialPeriod field → standard fact key
// ---------------------------------------------------------------------------

/**
 * Flatten a FinancialPeriod into a Record<string, number | null> keyed by
 * standard fact keys. This is the reverse of buildFinancialModel's
 * INCOME_MAP / BALANCE_MAP / CASHFLOW_MAP.
 */
function periodToFactMap(period: FinancialPeriod): Record<string, number | null> {
  const map: Record<string, number | null> = {};

  // Income → standard keys
  if (period.income.revenue !== undefined) map["TOTAL_REVENUE"] = period.income.revenue;
  if (period.income.cogs !== undefined) map["COST_OF_GOODS_SOLD"] = period.income.cogs;
  if (period.income.operatingExpenses !== undefined) map["TOTAL_OPERATING_EXPENSES"] = period.income.operatingExpenses;
  if (period.income.depreciation !== undefined) map["DEPRECIATION"] = period.income.depreciation;
  if (period.income.interest !== undefined) map["DEBT_SERVICE"] = period.income.interest;
  if (period.income.netIncome !== undefined) map["NET_INCOME"] = period.income.netIncome;

  // Balance → standard keys
  if (period.balance.cash !== undefined) map["CASH_AND_EQUIVALENTS"] = period.balance.cash;
  if (period.balance.accountsReceivable !== undefined) map["ACCOUNTS_RECEIVABLE"] = period.balance.accountsReceivable;
  if (period.balance.inventory !== undefined) map["INVENTORY"] = period.balance.inventory;
  if (period.balance.totalAssets !== undefined) map["TOTAL_ASSETS"] = period.balance.totalAssets;
  if (period.balance.shortTermDebt !== undefined) map["SHORT_TERM_DEBT"] = period.balance.shortTermDebt;
  if (period.balance.longTermDebt !== undefined) map["LONG_TERM_DEBT"] = period.balance.longTermDebt;
  if (period.balance.totalLiabilities !== undefined) map["TOTAL_LIABILITIES"] = period.balance.totalLiabilities;
  if (period.balance.equity !== undefined) map["TOTAL_EQUITY"] = period.balance.equity;

  // Cashflow → standard keys
  if (period.cashflow.ebitda !== undefined) map["EBITDA"] = period.cashflow.ebitda;
  if (period.cashflow.capex !== undefined) map["CAPITAL_EXPENDITURES"] = period.cashflow.capex;
  if (period.cashflow.cfads !== undefined) map["CASH_FLOW_AVAILABLE"] = period.cashflow.cfads;

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

      // Cascading: pre-compute dependencies within the same statement
      const enrichedFacts = { ...factsMap };
      for (const dep of sortedRows) {
        if (dep.formulaId && dep.order < row.order && dep.statement === row.statement) {
          const depVal = evaluateStandardFormula(dep.formulaId, enrichedFacts);
          if (depVal !== null) enrichedFacts[dep.key] = depVal;
        }
      }

      let value: number | null = null;

      if (row.formulaId) {
        value = evaluateStandardFormula(row.formulaId, enrichedFacts);
      } else {
        value = enrichedFacts[row.key] ?? null;
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
