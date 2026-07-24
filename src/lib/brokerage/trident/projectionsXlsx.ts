import "server-only";

/**
 * Projections XLSX generator.
 *
 * Final-mode only — preview borrowers see PDF only. At borrower pick, we
 * deliver the live editable model as XLSX alongside the formatted PDF so
 * the borrower has a working spreadsheet for their own banker conversations.
 *
 * SPEC-BROKERAGE-SBA-READY-V1 Ticket 5: the Sources & Uses and Balance
 * Sheet tabs used to dump raw JSON into a single cell. This is the document
 * a picked lender opens — bank-facing output quality, not an internal
 * artifact — so both tabs are now real tables: actual rows/columns, and
 * actual cell formulas (SUM, ratio checks) where SBA/bank convention
 * expects them, not just pre-computed static numbers.
 */

import ExcelJS from "exceljs";
import type { SourcesAndUsesResult } from "@/lib/sba/sbaSourcesAndUses";
import type { BalanceSheetYear } from "@/lib/sba/sbaBalanceSheetProjector";

export type ProjectionsXlsxInputs = {
  dealName: string;
  baseYear: {
    revenue: number;
    cogs: number;
    operatingExpenses: number;
    ebitda: number;
    netIncome: number;
  };
  annualProjections: Array<{
    year: number;
    revenue: number;
    ebitda: number;
    dscr: number;
    totalDebtService: number;
  }>;
  monthlyProjections: unknown[];
  sensitivityScenarios: Array<{
    name: string;
    revenueYear1?: number;
    dscrYear1?: number;
    [key: string]: unknown;
  }>;
  sourcesAndUses: SourcesAndUsesResult | null | undefined;
  balanceSheetProjections: BalanceSheetYear[] | null | undefined;
};

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1E3A8A" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" } };
const SUBTOTAL_FONT: Partial<ExcelJS.Font> = { bold: true };
const CURRENCY_FMT = '$#,##0;[Red]-$#,##0';
const PCT_FMT = "0.0%";
const RATIO_FMT = "0.00x";

function styleHeaderRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
  });
}

export async function renderProjectionsXlsx(
  inputs: ProjectionsXlsxInputs,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Buddy";
  wb.created = new Date();

  // Sheet 1 — Annual P&L.
  const pnl = wb.addWorksheet("Annual P&L");
  pnl.addRow(["Buddy SBA Package — Annual Projections", inputs.dealName]);
  pnl.addRow([]);
  const pnlHeader = pnl.addRow(["Year", "Revenue", "EBITDA", "Total Debt Service", "DSCR"]);
  styleHeaderRow(pnlHeader);
  pnl.addRow([
    "Base",
    inputs.baseYear.revenue,
    inputs.baseYear.ebitda,
    0,
    null,
  ]);
  for (const row of inputs.annualProjections) {
    pnl.addRow([row.year, row.revenue, row.ebitda, row.totalDebtService, row.dscr]);
  }
  pnl.getColumn(2).numFmt = CURRENCY_FMT;
  pnl.getColumn(3).numFmt = CURRENCY_FMT;
  pnl.getColumn(4).numFmt = CURRENCY_FMT;
  pnl.getColumn(5).numFmt = RATIO_FMT;
  pnl.columns.forEach((c) => (c.width = 20));

  // Sheet 2 — Year 1 monthly (shape-flexible).
  const monthly = wb.addWorksheet("Year 1 Monthly");
  monthly.addRow(["Year 1 Monthly Projections"]);
  if (
    Array.isArray(inputs.monthlyProjections) &&
    inputs.monthlyProjections.length > 0 &&
    typeof inputs.monthlyProjections[0] === "object" &&
    inputs.monthlyProjections[0] !== null
  ) {
    const first = inputs.monthlyProjections[0] as Record<string, unknown>;
    const headers = Object.keys(first);
    const monthlyHeader = monthly.addRow(headers);
    styleHeaderRow(monthlyHeader);
    for (const m of inputs.monthlyProjections as Array<Record<string, unknown>>) {
      monthly.addRow(headers.map((h) => (m[h] ?? null) as ExcelJS.CellValue));
    }
    monthly.columns.forEach((c) => (c.width = 16));
  }

  // Sheet 3 — Sensitivity.
  const sens = wb.addWorksheet("Sensitivity");
  const sensHeader = sens.addRow(["Scenario", "Year 1 Revenue", "Year 1 DSCR"]);
  styleHeaderRow(sensHeader);
  for (const s of inputs.sensitivityScenarios) {
    sens.addRow([s.name, s.revenueYear1 ?? null, s.dscrYear1 ?? null]);
  }
  sens.getColumn(2).numFmt = CURRENCY_FMT;
  sens.getColumn(3).numFmt = RATIO_FMT;
  sens.columns.forEach((c) => (c.width = 20));

  // Sheet 4 — Sources & Uses. Real rows/columns + SUM/ratio formulas, not a
  // JSON dump: a lender opening this tab expects the same layout a bank's
  // own S&U worksheet uses.
  renderSourcesAndUsesSheet(wb.addWorksheet("Sources & Uses"), inputs.sourcesAndUses ?? null);

  // Sheet 5 — Balance sheet. Real rows (line items) × columns (periods),
  // with SUM formulas for subtotals and formula-computed ratio checks.
  renderBalanceSheetSheet(wb.addWorksheet("Balance Sheet"), inputs.balanceSheetProjections ?? null);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}

function renderSourcesAndUsesSheet(
  ws: ExcelJS.Worksheet,
  su: SourcesAndUsesResult | null,
) {
  ws.columns = [
    { width: 34 },
    { width: 18 },
    { width: 14 },
  ];

  // Defensive: some historical/partial buddy_sba_packages rows carry
  // sources_and_uses as an empty `{}` placeholder rather than the real
  // { sources: [...], uses: [...], equityInjection: {...} } shape (a
  // package generated before that column was populated). Never assume the
  // shape — fall back to the same "not yet available" message a genuinely
  // null value gets, rather than crashing bundle generation.
  const hasRealShape =
    su != null &&
    Array.isArray(su.sources) &&
    Array.isArray(su.uses) &&
    su.equityInjection != null &&
    su.equityInjection.sellerNoteCheck != null;

  if (!hasRealShape) {
    ws.addRow(["Sources & Uses not yet available for this deal."]);
    return;
  }

  ws.addRow(["Sources & Uses of Funds"]);
  ws.addRow([]);

  // ── Sources ──────────────────────────────────────────────────────────
  const sourcesHeaderRow = ws.rowCount + 1;
  const sourcesHeader = ws.addRow(["Sources", "Amount", "% of Total"]);
  styleHeaderRow(sourcesHeader);
  const sourcesFirstDataRow = ws.rowCount + 1;
  for (const s of su.sources) {
    ws.addRow([s.label, s.amount, null]);
  }
  const sourcesLastDataRow = ws.rowCount;
  const totalSourcesRow = ws.rowCount + 1;
  const totalSourcesRowObj = ws.addRow([
    "Total Sources",
    { formula: `SUM(B${sourcesFirstDataRow}:B${sourcesLastDataRow})` } as ExcelJS.CellFormulaValue,
    null,
  ]);
  totalSourcesRowObj.font = SUBTOTAL_FONT;
  // % of total for each source row, computed against the Total Sources cell.
  for (let r = sourcesFirstDataRow; r <= sourcesLastDataRow; r++) {
    ws.getCell(`C${r}`).value = { formula: `B${r}/$B$${totalSourcesRow}` } as ExcelJS.CellFormulaValue;
  }

  ws.addRow([]);

  // ── Uses ─────────────────────────────────────────────────────────────
  const usesHeader = ws.addRow(["Uses", "Amount", "% of Total"]);
  styleHeaderRow(usesHeader);
  const usesFirstDataRow = ws.rowCount + 1;
  for (const u of su.uses) {
    ws.addRow([u.label, u.amount, null]);
  }
  const usesLastDataRow = ws.rowCount;
  const totalUsesRow = ws.rowCount + 1;
  const totalUsesRowObj = ws.addRow([
    "Total Uses",
    { formula: `SUM(B${usesFirstDataRow}:B${usesLastDataRow})` } as ExcelJS.CellFormulaValue,
    null,
  ]);
  totalUsesRowObj.font = SUBTOTAL_FONT;
  for (let r = usesFirstDataRow; r <= usesLastDataRow; r++) {
    ws.getCell(`C${r}`).value = { formula: `B${r}/$B$${totalUsesRow}` } as ExcelJS.CellFormulaValue;
  }

  ws.addRow([]);

  // ── Balance check ────────────────────────────────────────────────────
  const balanceRow = ws.addRow([
    "Sources − Uses (should be $0)",
    { formula: `B${totalSourcesRow}-B${totalUsesRow}` } as ExcelJS.CellFormulaValue,
    null,
  ]);
  balanceRow.font = SUBTOTAL_FONT;

  ws.addRow([]);

  // ── Equity injection check ───────────────────────────────────────────
  const eq = su.equityInjection;
  const eqHeader = ws.addRow(["Equity Injection Check", "", ""]);
  styleHeaderRow(eqHeader);
  const eqAmountRow = ws.addRow(["Equity Injection Amount", eq.actualAmount, null]);
  const eqPctRow = ws.rowCount;
  ws.addRow([
    "Equity Injection % of Total Sources",
    { formula: `B${eqAmountRow.number}/B${totalSourcesRow}` } as ExcelJS.CellFormulaValue,
    null,
  ]);
  ws.addRow(["SOP Minimum Required %", eq.minimumPct, null]);
  const minPctRow = ws.rowCount;
  const passRow = ws.addRow([
    "Passes SOP Minimum?",
    { formula: `IF(B${eqPctRow + 1}>=B${minPctRow},"PASS","FAIL")` } as ExcelJS.CellFormulaValue,
    null,
  ]);
  passRow.font = SUBTOTAL_FONT;
  if (!eq.passes) {
    ws.addRow(["Shortfall Amount", eq.shortfallAmount, null]);
  }
  if (eq.sellerNoteCheck.sellerNoteAmount > 0) {
    ws.addRow([]);
    ws.addRow(["Seller Note (as equity)", eq.sellerNoteCheck.sellerNoteAmount, null]);
    ws.addRow(["Seller Note % of Equity", eq.sellerNoteCheck.sellerNotePctOfEquity, null]);
    ws.addRow(["Full Standby Confirmed?", eq.sellerNoteCheck.fullStandbyConfirmed ? "Yes" : "No", null]);
    ws.addRow(["Seller Note Passes?", eq.sellerNoteCheck.passes ? "PASS" : "FAIL", null]);
  }

  // Formats
  for (let r = sourcesFirstDataRow; r <= totalSourcesRow; r++) {
    ws.getCell(`B${r}`).numFmt = CURRENCY_FMT;
    ws.getCell(`C${r}`).numFmt = PCT_FMT;
  }
  for (let r = usesFirstDataRow; r <= totalUsesRow; r++) {
    ws.getCell(`B${r}`).numFmt = CURRENCY_FMT;
    ws.getCell(`C${r}`).numFmt = PCT_FMT;
  }
  ws.getCell(`B${balanceRow.number}`).numFmt = CURRENCY_FMT;
  ws.getCell(`B${eqAmountRow.number}`).numFmt = CURRENCY_FMT;
  ws.getCell(`B${eqPctRow + 1}`).numFmt = PCT_FMT;
  ws.getCell(`B${minPctRow}`).numFmt = PCT_FMT;
}

const BS_ROWS: Array<{ label: string; key: keyof BalanceSheetYear; kind: "line" | "subtotal" | "ratio" }> = [
  { label: "Cash", key: "cash", kind: "line" },
  { label: "Accounts Receivable", key: "accountsReceivable", kind: "line" },
  { label: "Inventory", key: "inventory", kind: "line" },
  { label: "Total Current Assets", key: "totalCurrentAssets", kind: "subtotal" },
  { label: "Fixed Assets", key: "fixedAssets", kind: "line" },
  { label: "Total Assets", key: "totalAssets", kind: "subtotal" },
  { label: "Accounts Payable", key: "accountsPayable", kind: "line" },
  { label: "Short-Term Debt", key: "shortTermDebt", kind: "line" },
  { label: "Total Current Liabilities", key: "totalCurrentLiabilities", kind: "subtotal" },
  { label: "Long-Term Debt", key: "longTermDebt", kind: "line" },
  { label: "Total Liabilities", key: "totalLiabilities", kind: "subtotal" },
  { label: "Retained Earnings", key: "retainedEarnings", kind: "line" },
  { label: "Paid-In Capital", key: "paidInCapital", kind: "line" },
  { label: "Total Equity", key: "totalEquity", kind: "subtotal" },
  { label: "Current Ratio", key: "currentRatio", kind: "ratio" },
  { label: "Debt / Equity", key: "debtToEquity", kind: "ratio" },
  { label: "Working Capital", key: "workingCapital", kind: "subtotal" },
];

function renderBalanceSheetSheet(
  ws: ExcelJS.Worksheet,
  years: BalanceSheetYear[] | null,
) {
  // Defensive: some historical/partial buddy_sba_packages rows carry
  // balance_sheet_projections as an empty `{}` placeholder rather than a
  // real BalanceSheetYear[] array. Never assume the shape.
  if (!Array.isArray(years) || years.length === 0) {
    ws.addRow(["Balance sheet projections not yet available for this deal."]);
    return;
  }

  const sorted = [...years].sort((a, b) => a.year - b.year);
  const colHeaders = ["Line Item", ...sorted.map((y) => (y.label === "Actual" ? "Base Year" : `Year ${y.year}`))];
  const header = ws.addRow(colHeaders);
  styleHeaderRow(header);
  ws.getColumn(1).width = 26;
  for (let i = 2; i <= colHeaders.length; i++) ws.getColumn(i).width = 16;

  // Row indices for each balance-sheet key, so subtotal/ratio rows can
  // reference their component line items by formula instead of a
  // pre-computed static number.
  const rowIndexByKey = new Map<string, number>();

  for (const spec of BS_ROWS) {
    const rowNum = ws.rowCount + 1;
    rowIndexByKey.set(spec.key, rowNum);

    const values: Array<number | ExcelJS.CellFormulaValue | string> = sorted.map((y) => {
      if (spec.kind !== "subtotal" && spec.kind !== "ratio") return y[spec.key] as number;
      // Placeholder — filled below once every line-item row number is known
      // (subtotal formulas reference earlier rows in the same column).
      return y[spec.key] as number;
    });

    const row = ws.addRow([spec.label, ...values]);
    if (spec.kind === "subtotal" || spec.kind === "ratio") row.font = SUBTOTAL_FONT;

    for (let i = 0; i < sorted.length; i++) {
      const cell = row.getCell(2 + i);
      cell.numFmt = spec.kind === "ratio" ? RATIO_FMT : CURRENCY_FMT;
    }
  }

  // Now that every line item's row number is known, replace subtotal/ratio
  // cells with real formulas referencing the component rows in that same
  // year's column — a banker changing an input cell (e.g. Cash) sees every
  // dependent subtotal and ratio recompute live, matching how a bank's own
  // balance-sheet template behaves.
  const colFor = (yearIdx: number) => String.fromCharCode("B".charCodeAt(0) + yearIdx);

  for (let i = 0; i < sorted.length; i++) {
    const col = colFor(i);
    const r = (key: string) => rowIndexByKey.get(key)!;

    ws.getCell(`${col}${r("totalCurrentAssets")}`).value = {
      formula: `${col}${r("cash")}+${col}${r("accountsReceivable")}+${col}${r("inventory")}`,
    } as ExcelJS.CellFormulaValue;

    ws.getCell(`${col}${r("totalAssets")}`).value = {
      formula: `${col}${r("totalCurrentAssets")}+${col}${r("fixedAssets")}`,
    } as ExcelJS.CellFormulaValue;

    ws.getCell(`${col}${r("totalCurrentLiabilities")}`).value = {
      formula: `${col}${r("accountsPayable")}+${col}${r("shortTermDebt")}`,
    } as ExcelJS.CellFormulaValue;

    ws.getCell(`${col}${r("totalLiabilities")}`).value = {
      formula: `${col}${r("totalCurrentLiabilities")}+${col}${r("longTermDebt")}`,
    } as ExcelJS.CellFormulaValue;

    ws.getCell(`${col}${r("totalEquity")}`).value = {
      formula: `${col}${r("retainedEarnings")}+${col}${r("paidInCapital")}`,
    } as ExcelJS.CellFormulaValue;

    ws.getCell(`${col}${r("currentRatio")}`).value = {
      formula: `IF(${col}${r("totalCurrentLiabilities")}=0,0,${col}${r("totalCurrentAssets")}/${col}${r("totalCurrentLiabilities")})`,
    } as ExcelJS.CellFormulaValue;

    ws.getCell(`${col}${r("debtToEquity")}`).value = {
      formula: `IF(${col}${r("totalEquity")}=0,0,${col}${r("totalLiabilities")}/${col}${r("totalEquity")})`,
    } as ExcelJS.CellFormulaValue;

    ws.getCell(`${col}${r("workingCapital")}`).value = {
      formula: `${col}${r("totalCurrentAssets")}-${col}${r("totalCurrentLiabilities")}`,
    } as ExcelJS.CellFormulaValue;
  }
}
