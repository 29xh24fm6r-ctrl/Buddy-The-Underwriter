import type { SpreadTemplate } from "@/lib/financialSpreads/templates/templateTypes";
import type { FinancialFact, RenderedSpread, RenderedSpreadCellV2, SpreadColumnV2 } from "@/lib/financialSpreads/types";
import { factAsOfDate, factToInputRef } from "@/lib/financialSpreads/templateUtils";

// ---------------------------------------------------------------------------
// Row registry
// ---------------------------------------------------------------------------

type BalanceSheetRowKey =
  | "CASH_AND_EQUIVALENTS"
  | "ACCOUNTS_RECEIVABLE"
  | "INVENTORY"
  | "PREPAID_EXPENSES"
  | "OTHER_CURRENT_ASSETS"
  | "TOTAL_CURRENT_ASSETS"
  | "PROPERTY_PLANT_EQUIPMENT"
  | "ACCUMULATED_DEPRECIATION"
  | "NET_FIXED_ASSETS"
  | "INVESTMENT_PROPERTIES"
  | "INTANGIBLE_ASSETS"
  | "OTHER_NON_CURRENT_ASSETS"
  | "TOTAL_NON_CURRENT_ASSETS"
  | "TOTAL_ASSETS"
  | "ACCOUNTS_PAYABLE"
  | "ACCRUED_EXPENSES"
  | "SHORT_TERM_DEBT"
  | "CURRENT_PORTION_LTD"
  | "OTHER_CURRENT_LIABILITIES"
  | "TOTAL_CURRENT_LIABILITIES"
  | "LONG_TERM_DEBT"
  | "MORTGAGE_PAYABLE"
  | "DEFERRED_TAX_LIABILITY"
  | "OTHER_NON_CURRENT_LIABILITIES"
  | "TOTAL_NON_CURRENT_LIABILITIES"
  | "TOTAL_LIABILITIES"
  | "COMMON_STOCK"
  | "RETAINED_EARNINGS"
  | "PARTNERS_CAPITAL"
  | "MEMBERS_EQUITY"
  | "OTHER_EQUITY"
  | "TOTAL_EQUITY"
  | "TOTAL_LIABILITIES_AND_EQUITY"
  // Ratios
  | "CURRENT_RATIO"
  | "DEBT_TO_EQUITY"
  | "NET_WORTH";

type RowRegistryItem = {
  key: BalanceSheetRowKey;
  label: string;
  section: string;
  order: number;
  formula?: string;
};

const ROWS: RowRegistryItem[] = [
  // CURRENT ASSETS
  { key: "CASH_AND_EQUIVALENTS", label: "Cash & Equivalents", section: "CURRENT_ASSETS", order: 10 },
  { key: "ACCOUNTS_RECEIVABLE", label: "Accounts Receivable", section: "CURRENT_ASSETS", order: 20 },
  { key: "INVENTORY", label: "Inventory", section: "CURRENT_ASSETS", order: 30 },
  { key: "PREPAID_EXPENSES", label: "Prepaid Expenses", section: "CURRENT_ASSETS", order: 40 },
  { key: "OTHER_CURRENT_ASSETS", label: "Other Current Assets", section: "CURRENT_ASSETS", order: 50 },
  { key: "TOTAL_CURRENT_ASSETS", label: "Total Current Assets", section: "CURRENT_ASSETS", order: 60, formula: "BS_TOTAL_CURRENT_ASSETS" },

  // NON-CURRENT ASSETS
  { key: "PROPERTY_PLANT_EQUIPMENT", label: "Property, Plant & Equipment", section: "NON_CURRENT_ASSETS", order: 110 },
  { key: "ACCUMULATED_DEPRECIATION", label: "Accumulated Depreciation", section: "NON_CURRENT_ASSETS", order: 120 },
  { key: "NET_FIXED_ASSETS", label: "Net Fixed Assets", section: "NON_CURRENT_ASSETS", order: 130, formula: "BS_NET_FIXED_ASSETS" },
  { key: "INVESTMENT_PROPERTIES", label: "Investment Properties", section: "NON_CURRENT_ASSETS", order: 140 },
  { key: "INTANGIBLE_ASSETS", label: "Intangible Assets", section: "NON_CURRENT_ASSETS", order: 150 },
  { key: "OTHER_NON_CURRENT_ASSETS", label: "Other Non-Current Assets", section: "NON_CURRENT_ASSETS", order: 160 },
  { key: "TOTAL_NON_CURRENT_ASSETS", label: "Total Non-Current Assets", section: "NON_CURRENT_ASSETS", order: 170, formula: "BS_TOTAL_NON_CURRENT_ASSETS" },
  { key: "TOTAL_ASSETS", label: "Total Assets", section: "TOTAL_ASSETS", order: 200, formula: "BS_TOTAL_ASSETS" },

  // CURRENT LIABILITIES
  { key: "ACCOUNTS_PAYABLE", label: "Accounts Payable", section: "CURRENT_LIABILITIES", order: 310 },
  { key: "ACCRUED_EXPENSES", label: "Accrued Expenses", section: "CURRENT_LIABILITIES", order: 320 },
  { key: "SHORT_TERM_DEBT", label: "Short-Term Debt", section: "CURRENT_LIABILITIES", order: 330 },
  { key: "CURRENT_PORTION_LTD", label: "Current Portion of LTD", section: "CURRENT_LIABILITIES", order: 340 },
  { key: "OTHER_CURRENT_LIABILITIES", label: "Other Current Liabilities", section: "CURRENT_LIABILITIES", order: 350 },
  { key: "TOTAL_CURRENT_LIABILITIES", label: "Total Current Liabilities", section: "CURRENT_LIABILITIES", order: 360, formula: "BS_TOTAL_CURRENT_LIABILITIES" },

  // NON-CURRENT LIABILITIES
  { key: "LONG_TERM_DEBT", label: "Long-Term Debt", section: "NON_CURRENT_LIABILITIES", order: 410 },
  { key: "MORTGAGE_PAYABLE", label: "Mortgage Payable", section: "NON_CURRENT_LIABILITIES", order: 420 },
  { key: "DEFERRED_TAX_LIABILITY", label: "Deferred Tax Liability", section: "NON_CURRENT_LIABILITIES", order: 430 },
  { key: "OTHER_NON_CURRENT_LIABILITIES", label: "Other Non-Current Liabilities", section: "NON_CURRENT_LIABILITIES", order: 440 },
  { key: "TOTAL_NON_CURRENT_LIABILITIES", label: "Total Non-Current Liabilities", section: "NON_CURRENT_LIABILITIES", order: 450, formula: "BS_TOTAL_NON_CURRENT_LIABILITIES" },
  { key: "TOTAL_LIABILITIES", label: "Total Liabilities", section: "TOTAL_LIABILITIES", order: 500, formula: "BS_TOTAL_LIABILITIES" },

  // EQUITY
  { key: "COMMON_STOCK", label: "Common Stock", section: "EQUITY", order: 610 },
  { key: "RETAINED_EARNINGS", label: "Retained Earnings", section: "EQUITY", order: 620 },
  { key: "PARTNERS_CAPITAL", label: "Partners' Capital", section: "EQUITY", order: 630 },
  { key: "MEMBERS_EQUITY", label: "Members' Equity", section: "EQUITY", order: 640 },
  { key: "OTHER_EQUITY", label: "Other Equity", section: "EQUITY", order: 650 },
  { key: "TOTAL_EQUITY", label: "Total Equity", section: "EQUITY", order: 700, formula: "BS_TOTAL_EQUITY" },
  { key: "TOTAL_LIABILITIES_AND_EQUITY", label: "Total Liabilities & Equity", section: "TOTAL", order: 800, formula: "BS_TOTAL_LIABILITIES_AND_EQUITY" },

  // RATIOS
  { key: "NET_WORTH", label: "Net Worth", section: "RATIOS", order: 910, formula: "BS_NET_WORTH" },
  { key: "CURRENT_RATIO", label: "Current Ratio", section: "RATIOS", order: 920, formula: "BS_CURRENT_RATIO" },
  { key: "DEBT_TO_EQUITY", label: "Debt-to-Equity", section: "RATIOS", order: 930, formula: "BS_DEBT_TO_EQUITY" },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ValueMap = Record<string, number | null>;

function safeSum(values: Array<number | null | undefined>): number | null {
  let s = 0;
  let any = false;
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) { s += v; any = true; }
  }
  return any ? s : null;
}

function safeDivide(num: number | null, den: number | null): number | null {
  if (num === null || den === null || den === 0 || !Number.isFinite(num) || !Number.isFinite(den)) return null;
  return num / den;
}

function computeFormula(id: string, vals: ValueMap): number | null {
  switch (id) {
    case "BS_TOTAL_CURRENT_ASSETS":
      return safeSum([vals.CASH_AND_EQUIVALENTS, vals.ACCOUNTS_RECEIVABLE, vals.INVENTORY, vals.PREPAID_EXPENSES, vals.OTHER_CURRENT_ASSETS]);
    case "BS_NET_FIXED_ASSETS":
      return safeSum([vals.PROPERTY_PLANT_EQUIPMENT, vals.ACCUMULATED_DEPRECIATION !== null ? -(vals.ACCUMULATED_DEPRECIATION ?? 0) : null]);
    case "BS_TOTAL_NON_CURRENT_ASSETS":
      return safeSum([vals.NET_FIXED_ASSETS, vals.INVESTMENT_PROPERTIES, vals.INTANGIBLE_ASSETS, vals.OTHER_NON_CURRENT_ASSETS]);
    case "BS_TOTAL_ASSETS":
      return safeSum([vals.TOTAL_CURRENT_ASSETS, vals.TOTAL_NON_CURRENT_ASSETS]);
    case "BS_TOTAL_CURRENT_LIABILITIES":
      return safeSum([vals.ACCOUNTS_PAYABLE, vals.ACCRUED_EXPENSES, vals.SHORT_TERM_DEBT, vals.CURRENT_PORTION_LTD, vals.OTHER_CURRENT_LIABILITIES]);
    case "BS_TOTAL_NON_CURRENT_LIABILITIES":
      return safeSum([vals.LONG_TERM_DEBT, vals.MORTGAGE_PAYABLE, vals.DEFERRED_TAX_LIABILITY, vals.OTHER_NON_CURRENT_LIABILITIES]);
    case "BS_TOTAL_LIABILITIES":
      return safeSum([vals.TOTAL_CURRENT_LIABILITIES, vals.TOTAL_NON_CURRENT_LIABILITIES]);
    case "BS_TOTAL_EQUITY":
      return safeSum([vals.COMMON_STOCK, vals.RETAINED_EARNINGS, vals.PARTNERS_CAPITAL, vals.MEMBERS_EQUITY, vals.OTHER_EQUITY]);
    case "BS_TOTAL_LIABILITIES_AND_EQUITY":
      return safeSum([vals.TOTAL_LIABILITIES, vals.TOTAL_EQUITY]);
    case "BS_NET_WORTH":
      return safeSum([vals.TOTAL_ASSETS, vals.TOTAL_LIABILITIES !== null ? -(vals.TOTAL_LIABILITIES ?? 0) : null]);
    case "BS_CURRENT_RATIO":
      return safeDivide(vals.TOTAL_CURRENT_ASSETS, vals.TOTAL_CURRENT_LIABILITIES);
    case "BS_DEBT_TO_EQUITY":
      return safeDivide(vals.TOTAL_LIABILITIES, vals.TOTAL_EQUITY);
    default:
      return null;
  }
}

function formatCurrency(v: number): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatRatio(v: number): string {
  return v.toFixed(2);
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

function deriveAsOfDates(facts: FinancialFact[]): string[] {
  const dates = new Set<string>();
  for (const f of facts) {
    if (f.fact_type !== "BALANCE_SHEET") continue;
    const d = factAsOfDate(f) ?? f.fact_period_end;
    if (d && /^\d{4}-\d{2}-\d{2}/.test(String(d))) {
      dates.add(String(d).slice(0, 10));
    }
  }
  return Array.from(dates).sort().reverse(); // newest first
}

export function balanceSheetTemplate(): SpreadTemplate {
  const title = "Balance Sheet";

  return {
    spreadType: "BALANCE_SHEET",
    title,
    version: 1,
    columns: ["Line Item", "Value"],
    render: (args): RenderedSpread => {
      const bsFacts = args.facts.filter((f) => f.fact_type === "BALANCE_SHEET");
      const asOfDates = deriveAsOfDates(args.facts);

      // Build columns: one per as-of date
      const columnsV2: SpreadColumnV2[] = asOfDates.map((d) => ({
        key: d,
        label: d,
        kind: "other" as const,
        start_date: d,
        end_date: d,
      }));

      if (!columnsV2.length) {
        // Single placeholder column
        columnsV2.push({ key: "VALUE", label: "Value", kind: "other" });
      }

      // Build per-row per-column values
      const valuesByRow: Record<string, Record<string, number | null>> = {};
      const provenanceByRow: Record<string, Record<string, any>> = {};

      for (const r of ROWS) {
        valuesByRow[r.key] = {};
        provenanceByRow[r.key] = {};
      }

      // Map facts to cells
      for (const fact of bsFacts) {
        const rowKey = fact.fact_key;
        if (!valuesByRow[rowKey]) continue;
        if (typeof fact.fact_value_num !== "number") continue;

        const d = factAsOfDate(fact) ?? fact.fact_period_end;
        const colKey = d && /^\d{4}-\d{2}-\d{2}/.test(String(d)) ? String(d).slice(0, 10) : "VALUE";

        if (!columnsV2.find((c) => c.key === colKey)) continue;

        if (valuesByRow[rowKey][colKey] === undefined || valuesByRow[rowKey][colKey] === null) {
          valuesByRow[rowKey][colKey] = fact.fact_value_num;
          provenanceByRow[rowKey][colKey] = { source: "BALANCE_SHEET", input: factToInputRef(fact) };
        }
      }

      // Apply formulas per column (in order of ROWS)
      for (const colKey of columnsV2.map((c) => c.key)) {
        const colVals: ValueMap = {};
        for (const r of ROWS) {
          colVals[r.key] = valuesByRow[r.key]?.[colKey] ?? null;
        }

        for (const r of ROWS) {
          if (!r.formula) continue;
          if (valuesByRow[r.key][colKey] !== undefined && valuesByRow[r.key][colKey] !== null) continue;
          const computed = computeFormula(r.formula, colVals);
          if (computed !== null) {
            valuesByRow[r.key][colKey] = computed;
            colVals[r.key] = computed;
            provenanceByRow[r.key][colKey] = { source: "Formula", formula: r.formula };
          }
        }
      }

      const rows = ROWS
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((r) => {
          const valuesByCol: Record<string, number | null> = {};
          const displayByCol: Record<string, string | null> = {};
          const provByCol: Record<string, any> = {};

          for (const c of columnsV2) {
            const v = valuesByRow[r.key]?.[c.key] ?? null;
            valuesByCol[c.key] = v;
            provByCol[c.key] = provenanceByRow[r.key]?.[c.key] ?? null;

            if (v === null) {
              displayByCol[c.key] = null;
            } else if (r.key === "CURRENT_RATIO" || r.key === "DEBT_TO_EQUITY") {
              displayByCol[c.key] = formatRatio(v);
            } else {
              displayByCol[c.key] = formatCurrency(v);
            }
          }

          const cell: RenderedSpreadCellV2 = {
            value: columnsV2.length === 1 ? (valuesByCol[columnsV2[0].key] ?? null) : null,
            valueByCol: valuesByCol,
            displayByCol,
            provenanceByCol: provByCol,
          };

          return {
            key: r.key,
            label: r.label,
            section: r.section,
            values: [cell],
            formula: r.formula ?? null,
          };
        });

      return {
        schema_version: 3,
        schemaVersion: 1,
        title,
        spread_type: "BALANCE_SHEET",
        status: "ready",
        generatedAt: new Date().toISOString(),
        asOf: asOfDates[0] ?? null,
        columns: ["Line Item", ...columnsV2.map((c) => c.label)],
        columnsV2,
        rows,
        meta: {
          template: "canonical_balance_sheet_v1",
          version: 1,
          row_registry: ROWS.map((r) => r.key),
          column_registry: columnsV2.map((c) => c.key),
          as_of_dates: asOfDates,
        },
      };
    },
  };
}
