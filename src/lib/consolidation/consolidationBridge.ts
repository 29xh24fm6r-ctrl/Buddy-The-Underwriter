/**
 * Consolidation Bridge — God Tier Phase 2C, Section 6B
 *
 * Banker-facing bridge table: entity-by-entity breakdown with eliminations
 * and consolidated totals for each key line item.
 *
 * Pure function — no DB, no server imports.
 */

import type { EntityFinancials, EliminationEntry, ConsolidatedFinancials } from "./consolidationEngine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BridgeLineItem = {
  label: string;
  canonicalKey: string;
  entities: Record<string, number>; // entity name → amount
  eliminations: number;
  consolidatedTotal: number;
  isSubtotal: boolean;
  isRatio: boolean;
};

export type ConsolidationBridge = {
  lineItems: BridgeLineItem[];
  entityNames: string[];       // ordered column headers
  entityCount: number;
};

// ---------------------------------------------------------------------------
// Bridge line definitions
// ---------------------------------------------------------------------------

type LineSpec = {
  label: string;
  canonicalKey: string;
  getter: (e: EntityFinancials) => number;
  consGetter: (c: ConsolidatedFinancials) => number;
  eliminationGetter: (elim: EliminationSummary) => number;
  isSubtotal?: boolean;
  isRatio?: boolean;
};

type EliminationSummary = {
  revenueEliminated: number;
  expenseEliminated: number;
  loansEliminated: number;
  interestEliminated: number;
};

const LINE_SPECS: LineSpec[] = [
  // Income Statement
  {
    label: "Net Revenue",
    canonicalKey: "CONS_REVENUE",
    getter: (e) => e.revenue ?? 0,
    consGetter: (c) => c.consRevenue,
    eliminationGetter: (el) => -el.revenueEliminated,
  },
  {
    label: "Cost of Goods Sold",
    canonicalKey: "CONS_COGS",
    getter: (e) => e.cogs ?? 0,
    consGetter: (c) => c.consCogs,
    eliminationGetter: () => 0,
  },
  {
    label: "Gross Profit",
    canonicalKey: "CONS_GROSS_PROFIT",
    getter: (e) => e.grossProfit ?? 0,
    consGetter: (c) => c.consGrossProfit,
    eliminationGetter: (el) => -el.revenueEliminated,
    isSubtotal: true,
  },
  {
    label: "Operating Expenses",
    canonicalKey: "CONS_OPEX",
    getter: (e) => e.operatingExpenses ?? 0,
    consGetter: (c) => c.consOperatingExpenses,
    eliminationGetter: (el) => -el.expenseEliminated,
  },
  {
    label: "EBITDA",
    canonicalKey: "CONS_EBITDA",
    getter: (e) => e.ebitda ?? 0,
    consGetter: (c) => c.consEbitda,
    eliminationGetter: () => 0, // net of revenue+expense eliminations
    isSubtotal: true,
  },
  {
    label: "Interest Expense",
    canonicalKey: "CONS_INTEREST",
    getter: (e) => e.interestExpense ?? 0,
    consGetter: (c) => c.consInterestExpense,
    eliminationGetter: (el) => -el.interestEliminated,
  },
  {
    label: "Net Income",
    canonicalKey: "CONS_NET_INCOME",
    getter: (e) => e.netIncome ?? 0,
    consGetter: (c) => c.consNetIncome,
    eliminationGetter: () => 0,
    isSubtotal: true,
  },
  // Balance Sheet
  {
    label: "Total Assets",
    canonicalKey: "CONS_TOTAL_ASSETS",
    getter: (e) => e.totalAssets ?? 0,
    consGetter: (c) => c.consTotalAssets,
    eliminationGetter: (el) => -el.loansEliminated,
  },
  {
    label: "Total Liabilities",
    canonicalKey: "CONS_TOTAL_LIABILITIES",
    getter: (e) => e.totalLiabilities ?? 0,
    consGetter: (c) => c.consTotalLiabilities,
    eliminationGetter: (el) => -el.loansEliminated,
  },
  {
    label: "Total Equity",
    canonicalKey: "CONS_TOTAL_EQUITY",
    getter: (e) => e.totalEquity ?? 0,
    consGetter: (c) => c.consTotalEquity,
    eliminationGetter: () => 0,
  },
  {
    label: "Total Funded Debt",
    canonicalKey: "CONS_TOTAL_FUNDED_DEBT",
    getter: (e) => e.totalFundedDebt ?? 0,
    consGetter: (c) => c.consTotalFundedDebt,
    eliminationGetter: (el) => -el.loansEliminated,
  },
  // Cash Flow / DSCR
  {
    label: "Annual Debt Service",
    canonicalKey: "CONS_ANNUAL_DEBT_SERVICE",
    getter: (e) => e.annualDebtService ?? 0,
    consGetter: (c) => c.consAnnualDebtService,
    eliminationGetter: () => 0,
  },
  {
    label: "NCADS",
    canonicalKey: "CONS_NCADS",
    getter: (e) => e.ncads ?? 0,
    consGetter: (c) => c.consNcads,
    eliminationGetter: () => 0,
    isSubtotal: true,
  },
  {
    label: "DSCR",
    canonicalKey: "CONS_DSCR",
    getter: (e) => (e.ncads && e.annualDebtService && e.annualDebtService > 0)
      ? e.ncads / e.annualDebtService : 0,
    consGetter: (c) => c.consDscr ?? 0,
    eliminationGetter: () => 0,
    isRatio: true,
  },
];

// ---------------------------------------------------------------------------
// Build bridge
// ---------------------------------------------------------------------------

export function buildConsolidationBridge(
  entities: EntityFinancials[],
  consolidated: ConsolidatedFinancials,
  totalRevenueEliminated: number,
  totalExpenseEliminated: number,
  totalLoansEliminated: number,
  eliminations: EliminationEntry[],
): ConsolidationBridge {
  const entityNames = entities.map((e) => e.entityName);

  // Compute interest eliminated from elimination entries
  const interestEliminated = eliminations
    .filter((e) => e.transactionType === "interest")
    .reduce((sum, e) => sum + e.debitAmount, 0);

  const elimSummary: EliminationSummary = {
    revenueEliminated: totalRevenueEliminated,
    expenseEliminated: totalExpenseEliminated,
    loansEliminated: totalLoansEliminated,
    interestEliminated,
  };

  const lineItems: BridgeLineItem[] = LINE_SPECS.map((spec) => {
    const entityAmounts: Record<string, number> = {};
    for (const e of entities) {
      entityAmounts[e.entityName] = spec.getter(e);
    }

    return {
      label: spec.label,
      canonicalKey: spec.canonicalKey,
      entities: entityAmounts,
      eliminations: spec.eliminationGetter(elimSummary),
      consolidatedTotal: spec.consGetter(consolidated),
      isSubtotal: spec.isSubtotal ?? false,
      isRatio: spec.isRatio ?? false,
    };
  });

  return {
    lineItems,
    entityNames,
    entityCount: entities.length,
  };
}

// ---------------------------------------------------------------------------
// Format bridge for display (markdown table)
// ---------------------------------------------------------------------------

export function formatBridgeAsMarkdown(bridge: ConsolidationBridge): string {
  const cols = bridge.entityNames;
  const header = `| Line Item | ${cols.join(" | ")} | Eliminations | Consolidated |`;
  const separator = `|---|${cols.map(() => "---").join("|")}|---|---|`;

  const rows = bridge.lineItems.map((item) => {
    const entityVals = cols.map((name) => {
      const val = item.entities[name] ?? 0;
      return item.isRatio ? `${val.toFixed(2)}x` : fmtCurrency(val);
    });
    const elimVal = item.eliminations !== 0
      ? (item.isRatio ? "—" : fmtCurrency(item.eliminations))
      : "—";
    const consVal = item.isRatio
      ? `**${item.consolidatedTotal.toFixed(2)}x**`
      : `**${fmtCurrency(item.consolidatedTotal)}**`;

    return `| ${item.isSubtotal ? "**" + item.label + "**" : item.label} | ${entityVals.join(" | ")} | ${elimVal} | ${consVal} |`;
  });

  return [header, separator, ...rows].join("\n");
}

function fmtCurrency(val: number): string {
  if (val === 0) return "—";
  const sign = val < 0 ? "(" : "";
  const end = val < 0 ? ")" : "";
  return `${sign}$${Math.abs(val).toLocaleString("en-US", { maximumFractionDigits: 0 })}${end}`;
}
