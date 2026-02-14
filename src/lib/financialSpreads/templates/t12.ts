import type { SpreadTemplate } from "@/lib/financialSpreads/templates/templateTypes";
import type { FinancialFact, RenderedSpread, RenderedSpreadCellV2, SpreadColumnV2 } from "@/lib/financialSpreads/types";
import { computeT12Formula, type T12FormulaId, type T12RowKey } from "@/lib/financialSpreads/formulas";
import { factAsOfDate, factToInputRef, pickLatestFact } from "@/lib/financialSpreads/templateUtils";

type RowSeries = Record<string, Record<string, number | null>>;
type RowProvenance = Record<string, Record<string, any | null>>;

type RowRegistryItem = {
  key: T12RowKey;
  label: string;
  section: string;
  order: number;
  formula?: T12FormulaId;
};

const ROWS: RowRegistryItem[] = [
  // INCOME
  { key: "GROSS_RENTAL_INCOME", label: "Gross Rental Income", section: "INCOME", order: 10 },
  { key: "VACANCY_CONCESSIONS", label: "Vacancy & Concessions", section: "INCOME", order: 20 },
  { key: "OTHER_INCOME", label: "Other Income", section: "INCOME", order: 30 },
  { key: "TOTAL_INCOME", label: "Total Income", section: "INCOME", order: 40, formula: "T12_TOTAL_INCOME" },

  // OPERATING EXPENSES
  { key: "REPAIRS_MAINTENANCE", label: "Repairs & Maintenance", section: "OPERATING_EXPENSES", order: 110 },
  { key: "UTILITIES", label: "Utilities", section: "OPERATING_EXPENSES", order: 120 },
  { key: "PROPERTY_MANAGEMENT", label: "Property Management", section: "OPERATING_EXPENSES", order: 130 },
  { key: "REAL_ESTATE_TAXES", label: "Real Estate Taxes", section: "OPERATING_EXPENSES", order: 140 },
  { key: "INSURANCE", label: "Insurance", section: "OPERATING_EXPENSES", order: 150 },
  { key: "PAYROLL", label: "Payroll", section: "OPERATING_EXPENSES", order: 160 },
  { key: "MARKETING", label: "Marketing", section: "OPERATING_EXPENSES", order: 170 },
  { key: "PROFESSIONAL_FEES", label: "Professional Fees", section: "OPERATING_EXPENSES", order: 180 },
  { key: "OTHER_OPEX", label: "Other Operating Expenses", section: "OPERATING_EXPENSES", order: 190 },
  { key: "TOTAL_OPEX", label: "Total Operating Expenses", section: "OPERATING_EXPENSES", order: 200, formula: "T12_TOTAL_OPEX" },

  // NOI
  { key: "NOI", label: "Net Operating Income (NOI)", section: "NET_OPERATING_INCOME", order: 300, formula: "T12_NOI" },

  // CAPEX / RESERVES
  { key: "REPLACEMENT_RESERVES", label: "Replacement Reserves", section: "CAPEX_RESERVES", order: 410 },
  { key: "CAPEX", label: "CapEx", section: "CAPEX_RESERVES", order: 420 },
  { key: "TOTAL_CAPEX", label: "Total CapEx / Reserves", section: "CAPEX_RESERVES", order: 430, formula: "T12_TOTAL_CAPEX" },

  // CASH FLOW
  {
    key: "NET_CASH_FLOW_BEFORE_DEBT",
    label: "Net Cash Flow Before Debt",
    section: "CASH_FLOW",
    order: 510,
    formula: "T12_NET_CASH_FLOW_BEFORE_DEBT",
  },
  { key: "DEBT_SERVICE", label: "Debt Service", section: "CASH_FLOW", order: 520 },
  { key: "CASH_FLOW_AFTER_DEBT", label: "Cash Flow After Debt", section: "CASH_FLOW", order: 530 },

  // RATIOS
  { key: "OPEX_RATIO", label: "OpEx Ratio", section: "RATIOS", order: 610, formula: "T12_OPEX_RATIO" },
  { key: "NOI_MARGIN", label: "NOI Margin", section: "RATIOS", order: 620, formula: "T12_NOI_MARGIN" },
];

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function parseIsoDateOrToday(asOfDate: string | null): Date {
  if (asOfDate && /^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
    const [y, m, d] = asOfDate.split("-").map((x) => Number(x));
    return new Date(Date.UTC(y, m - 1, d));
  }
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

function monthLabel(d: Date): string {
  const m = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${m} ${d.getUTCFullYear()}`;
}

function startOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function endOfMonthUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

export function buildT12Columns(asOfDate: string | null, months = 12): SpreadColumnV2[] {
  const asOf = parseIsoDateOrToday(asOfDate);
  const asOfMonth = startOfMonthUTC(asOf);

  // Oldest -> newest.
  const monthCols: SpreadColumnV2[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(asOfMonth.getUTCFullYear(), asOfMonth.getUTCMonth() - i, 1));
    monthCols.push({
      key: monthKey(d),
      label: monthLabel(d),
      kind: "month",
      start_date: isoDate(startOfMonthUTC(d)),
      end_date: isoDate(endOfMonthUTC(d)),
    });
  }

  const ytdStart = new Date(Date.UTC(asOf.getUTCFullYear(), 0, 1));
  const ytdEnd = endOfMonthUTC(asOf);
  const pyYtdStart = new Date(Date.UTC(asOf.getUTCFullYear() - 1, 0, 1));
  const pyYtdEnd = new Date(Date.UTC(asOf.getUTCFullYear() - 1, ytdEnd.getUTCMonth() + 1, 0));

  return [
    ...monthCols,
    { key: "YTD", label: "YTD", kind: "ytd", start_date: isoDate(ytdStart), end_date: isoDate(ytdEnd) },
    { key: "PY_YTD", label: "PY YTD", kind: "prior_ytd", start_date: isoDate(pyYtdStart), end_date: isoDate(pyYtdEnd) },
    {
      key: "TTM",
      label: "TTM",
      kind: "ttm",
      start_date: monthCols.length ? monthCols[0]?.start_date ?? null : null,
      end_date: monthCols.length ? monthCols[monthCols.length - 1]?.end_date ?? null : null,
    },
  ];
}

function emptySeries(): RowSeries {
  const out: RowSeries = {};
  for (const r of ROWS) out[r.key] = {};
  return out;
}

function emptyProvenance(): RowProvenance {
  const out: RowProvenance = {};
  for (const r of ROWS) out[r.key] = {};
  return out;
}

function fillAggregates(args: {
  valuesByRow: RowSeries;
  columns: SpreadColumnV2[];
  asOfDate: string | null;
}) {
  const monthCols = args.columns.filter((c) => c.kind === "month");
  const asOf = parseIsoDateOrToday(args.asOfDate);
  const ytdYear = asOf.getUTCFullYear();
  const ytdLastMonth = asOf.getUTCMonth();

  const ytdMonthKeys = monthCols
    .map((c) => c.key)
    .filter((k) => {
      const [y, m] = k.split("-").map((x) => Number(x));
      return y === ytdYear && (m - 1) <= ytdLastMonth;
    });

  const pyYtdMonthKeys = ytdMonthKeys.map((k) => {
    const [y, m] = k.split("-");
    return `${Number(y) - 1}-${m}`;
  });

  for (const rowKey of Object.keys(args.valuesByRow)) {
    const row = args.valuesByRow[rowKey] ?? {};

    const ttm = safeSumKeys(row, monthCols.map((c) => c.key));
    const ytd = safeSumKeys(row, ytdMonthKeys);
    const pyYtd = safeSumKeys(row, pyYtdMonthKeys);

    if (row.TTM === undefined || row.TTM === null) {
      if (ttm !== null) row.TTM = ttm;
    }
    if (row.YTD === undefined || row.YTD === null) {
      if (ytd !== null) row.YTD = ytd;
    }
    if (row.PY_YTD === undefined || row.PY_YTD === null) {
      if (pyYtd !== null) row.PY_YTD = pyYtd;
    }
  }
}

function safeSumKeys(row: Record<string, number | null>, keys: string[]): number | null {
  let sum = 0;
  let any = false;
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "number" && Number.isFinite(v)) {
      sum += v;
      any = true;
    }
  }
  return any ? sum : null;
}

export function applyT12FormulasPerColumn(args: {
  valuesByRow: RowSeries;
  columns: SpreadColumnV2[];
  preserveExistingComputed?: boolean;
}) {
  const colKeys = args.columns.map((c) => c.key);
  const preserve = args.preserveExistingComputed ?? true;

  const formulaRows = ROWS.filter((r) => r.formula);

  for (const colKey of colKeys) {
    // Evaluate in a fixed order.
    for (const fr of formulaRows) {
      const key = fr.key;
      const existing = args.valuesByRow[key]?.[colKey] ?? null;
      if (preserve && existing !== null) continue;

      const computed = computeT12Formula({
        formula: fr.formula as T12FormulaId,
        get: (rowKey: T12RowKey) => args.valuesByRow[rowKey]?.[colKey] ?? null,
      });
      if (!args.valuesByRow[key]) args.valuesByRow[key] = {};
      args.valuesByRow[key][colKey] = computed.value;
    }
  }
}

function formatCurrency(v: number): string {
  return v.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatPercent01(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function buildRowCell(args: {
  rowKey: T12RowKey;
  columns: SpreadColumnV2[];
  valuesByCol: Record<string, number | null>;
  provenanceByCol: Record<string, any | null>;
}): RenderedSpreadCellV2 {
  const displayByCol: Record<string, string | null> = {};
  for (const c of args.columns) {
    const v = args.valuesByCol[c.key] ?? null;
    if (v === null) {
      displayByCol[c.key] = null;
      continue;
    }
    if (args.rowKey === "OPEX_RATIO" || args.rowKey === "NOI_MARGIN") {
      displayByCol[c.key] = formatPercent01(v);
    } else {
      displayByCol[c.key] = formatCurrency(v);
    }
  }

  const ttm = args.valuesByCol.TTM ?? null;
  return {
    value: ttm,
    valueByCol: args.valuesByCol,
    displayByCol,
    provenanceByCol: args.provenanceByCol,
  };
}

function deriveAsOfDate(facts: FinancialFact[]): string | null {
  let out: string | null = null;
  for (const f of facts) {
    const d = factAsOfDate(f);
    if (!d) continue;
    if (!out || d > out) out = d;
  }
  return out;
}

/**
 * Map INCOME_STATEMENT fact keys to T12 row keys.
 * Used by the AI extractor to populate monthly columns.
 */
const INCOME_STATEMENT_TO_T12_ROW: Record<string, T12RowKey> = {
  GROSS_RENTAL_INCOME: "GROSS_RENTAL_INCOME",
  EFFECTIVE_GROSS_INCOME: "GROSS_RENTAL_INCOME",
  VACANCY_CONCESSIONS: "VACANCY_CONCESSIONS",
  OTHER_INCOME: "OTHER_INCOME",
  REPAIRS_MAINTENANCE: "REPAIRS_MAINTENANCE",
  UTILITIES: "UTILITIES",
  PROPERTY_MANAGEMENT: "PROPERTY_MANAGEMENT",
  REAL_ESTATE_TAXES: "REAL_ESTATE_TAXES",
  INSURANCE: "INSURANCE",
  PAYROLL: "PAYROLL",
  MARKETING: "MARKETING",
  PROFESSIONAL_FEES: "PROFESSIONAL_FEES",
  OTHER_OPEX: "OTHER_OPEX",
  TOTAL_OPERATING_EXPENSES: "TOTAL_OPEX",
  NET_OPERATING_INCOME: "NOI",
  CAPITAL_EXPENDITURES: "CAPEX",
  DEBT_SERVICE: "DEBT_SERVICE",
};

function normalizeInputs(args: { facts: FinancialFact[]; columns: SpreadColumnV2[]; asOfDate: string | null }): {
  valuesByRow: RowSeries;
  provenanceByRow: RowProvenance;
} {
  const valuesByRow = emptySeries();
  const provenanceByRow = emptyProvenance();

  const monthCols = args.columns.filter((c) => c.kind === "month");

  // ── New: populate from INCOME_STATEMENT facts with period-tagged data ────
  const incomeStatementFacts = args.facts.filter((f) => f.fact_type === "INCOME_STATEMENT");

  for (const fact of incomeStatementFacts) {
    const rowKey = INCOME_STATEMENT_TO_T12_ROW[fact.fact_key];
    if (!rowKey) continue;
    if (typeof fact.fact_value_num !== "number") continue;

    // Try to map this fact to a specific month column using its period_start
    const periodStart = fact.fact_period_start;
    if (periodStart && /^\d{4}-\d{2}/.test(periodStart)) {
      const factMonthKey = periodStart.slice(0, 7); // "YYYY-MM"
      const matchingCol = monthCols.find((c) => c.key === factMonthKey);
      if (matchingCol) {
        // Only set if not already populated (first-write-wins for same row+col)
        if (valuesByRow[rowKey]?.[factMonthKey] === undefined || valuesByRow[rowKey]?.[factMonthKey] === null) {
          if (!valuesByRow[rowKey]) valuesByRow[rowKey] = {};
          valuesByRow[rowKey][factMonthKey] = fact.fact_value_num;
          if (!provenanceByRow[rowKey]) provenanceByRow[rowKey] = {};
          provenanceByRow[rowKey][factMonthKey] = { source: "INCOME_STATEMENT", input: factToInputRef(fact) };
        }
        continue;
      }
    }

    // Fallback: if the fact has no period or doesn't match a month column, map to TTM
    if (valuesByRow[rowKey]?.TTM === undefined || valuesByRow[rowKey]?.TTM === null) {
      if (!valuesByRow[rowKey]) valuesByRow[rowKey] = {};
      valuesByRow[rowKey].TTM = fact.fact_value_num;
      if (!provenanceByRow[rowKey]) provenanceByRow[rowKey] = {};
      provenanceByRow[rowKey].TTM = { source: "INCOME_STATEMENT", input: factToInputRef(fact) };
    }
  }

  // ── Tax return facts (1120/1065) → map into T12 rows (fill empty cells only) ──
  const TAX_RETURN_TO_T12_ROW: Record<string, T12RowKey> = {
    GROSS_RECEIPTS: "GROSS_RENTAL_INCOME",
    TOTAL_INCOME: "GROSS_RENTAL_INCOME",
    OFFICER_COMPENSATION: "PAYROLL",
    SALARIES_WAGES: "PAYROLL",
    REPAIRS_MAINTENANCE: "REPAIRS_MAINTENANCE",
    INSURANCE_EXPENSE: "INSURANCE",
    TAXES_LICENSES: "REAL_ESTATE_TAXES",
    RENT_EXPENSE: "OTHER_OPEX",
    OTHER_DEDUCTIONS: "OTHER_OPEX",
    // NOTE: Tax return NET_INCOME includes non-operating deductions (depreciation, interest)
    // and is NOT equivalent to property NOI. Used as best-effort approximation when
    // no income statement is available. Income statement data takes precedence.
    NET_INCOME: "NOI",
  };

  const taxReturnFacts = args.facts.filter((f) => f.fact_type === "TAX_RETURN");
  for (const fact of taxReturnFacts) {
    const rowKey = TAX_RETURN_TO_T12_ROW[fact.fact_key];
    if (!rowKey) continue;
    if (typeof fact.fact_value_num !== "number") continue;

    // Only fill empty cells — income statement data takes priority
    if (valuesByRow[rowKey]?.TTM === undefined || valuesByRow[rowKey]?.TTM === null) {
      if (!valuesByRow[rowKey]) valuesByRow[rowKey] = {};
      valuesByRow[rowKey].TTM = fact.fact_value_num;
      if (!provenanceByRow[rowKey]) provenanceByRow[rowKey] = {};
      provenanceByRow[rowKey].TTM = { source: "TAX_RETURN", input: factToInputRef(fact) };
    }
  }

  // ── Legacy: fallback to existing T12-type single-column totals mapped into TTM ──
  const egI = pickLatestFact({ facts: args.facts, factType: "T12", factKey: "EFFECTIVE_GROSS_INCOME" });
  const opex = pickLatestFact({ facts: args.facts, factType: "T12", factKey: "OPERATING_EXPENSES" });
  const noi = pickLatestFact({ facts: args.facts, factType: "T12", factKey: "NOI" });

  if (egI && typeof egI.fact_value_num === "number") {
    if (valuesByRow.GROSS_RENTAL_INCOME.TTM === undefined || valuesByRow.GROSS_RENTAL_INCOME.TTM === null) {
      valuesByRow.GROSS_RENTAL_INCOME.TTM = egI.fact_value_num;
      provenanceByRow.GROSS_RENTAL_INCOME.TTM = { source: "Facts", input: factToInputRef(egI) };
    }
  }

  if (opex && typeof opex.fact_value_num === "number") {
    if (valuesByRow.OTHER_OPEX.TTM === undefined || valuesByRow.OTHER_OPEX.TTM === null) {
      valuesByRow.OTHER_OPEX.TTM = opex.fact_value_num;
      provenanceByRow.OTHER_OPEX.TTM = { source: "Facts", input: factToInputRef(opex) };
    }
  }

  // If we only have NOI but no income/opex, preserve it on the computed row.
  if (noi && typeof noi.fact_value_num === "number") {
    if (valuesByRow.NOI.TTM === undefined || valuesByRow.NOI.TTM === null) {
      valuesByRow.NOI.TTM = noi.fact_value_num;
      provenanceByRow.NOI.TTM = { source: "Facts", input: factToInputRef(noi) };
    }
  }

  // Derive YTD/PY_YTD/TTM from months (if any) and fill aggregate keys.
  fillAggregates({ valuesByRow, columns: args.columns, asOfDate: args.asOfDate });

  return { valuesByRow, provenanceByRow };
}

export function t12Template(): SpreadTemplate {
  const title = "Operating Performance";

  return {
    spreadType: "T12",
    title,
    version: 3,
    priority: 10,
    prerequisites: () => ({
      facts: { fact_types: ["INCOME_STATEMENT", "TAX_RETURN"] },
      note: "Needs operating performance facts from business tax returns or income statements",
    }),
    columns: ["Line Item", "TTM"],
    render: (args): RenderedSpread => {
      const asOf = deriveAsOfDate(args.facts);
      const columnsV2 = buildT12Columns(asOf, 12);

      const { valuesByRow, provenanceByRow } = normalizeInputs({ facts: args.facts, columns: columnsV2, asOfDate: asOf });

      // Apply formulas per columnKey.
      applyT12FormulasPerColumn({ valuesByRow, columns: columnsV2, preserveExistingComputed: true });

      const rows = ROWS
        .slice()
        .sort((a, b) => a.order - b.order)
        .map((r) => {
          const valuesByCol = valuesByRow[r.key] ?? {};
          const provByCol = provenanceByRow[r.key] ?? {};
          const cell = buildRowCell({ rowKey: r.key, columns: columnsV2, valuesByCol, provenanceByCol: provByCol });

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
        schemaVersion: 3,
        title,
        spread_type: "T12",
        status: "ready",
        generatedAt: new Date().toISOString(),
        asOf,
        columns: ["Line Item", ...columnsV2.map((c) => c.label)],
        columnsV2,
        rows,
        meta: {
          template: "canonical_t12_v3",
          version: 3,
          row_registry: ROWS.map((r) => r.key),
          column_registry: columnsV2.map((c) => c.key),
        },
      };
    },
  };
}
