import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { renderProjectionsXlsx } from "../projectionsXlsx";
import type { SourcesAndUsesResult } from "@/lib/sba/sbaSourcesAndUses";
import type { BalanceSheetYear } from "@/lib/sba/sbaBalanceSheetProjector";

const SOURCES_AND_USES: SourcesAndUsesResult = {
  sources: [
    { label: "SBA Loan Proceeds", amount: 500_000, pctOfTotal: 0.9, kind: "sba_loan" },
    { label: "Equity Injection — cash savings", amount: 55_000, pctOfTotal: 0.1, kind: "equity_injection" },
  ],
  uses: [
    { label: "Business Acquisition", amount: 500_000, pctOfTotal: 0.9, category: "acquisition" },
    { label: "Working Capital", amount: 55_000, pctOfTotal: 0.1, category: "working_capital" },
  ],
  totalSources: 555_000,
  totalUses: 555_000,
  balanced: true,
  imbalance: 0,
  equityInjection: {
    required: true,
    minimumPct: 0.1,
    actualPct: 0.0991,
    actualAmount: 55_000,
    totalSourcesExcludingEquity: 500_000,
    passes: false,
    shortfallAmount: 500,
    sellerNoteCheck: {
      sellerNoteAmount: 0,
      sellerNotePctOfEquity: 0,
      fullStandbyConfirmed: false,
      passes: true,
      failureReason: null,
    },
  },
};

const BALANCE_SHEET: BalanceSheetYear[] = [0, 1, 2, 3].map((year) => ({
  year: year as 0 | 1 | 2 | 3,
  label: year === 0 ? "Actual" : "Projected",
  cash: 50_000 + year * 5_000,
  accountsReceivable: 20_000,
  inventory: 10_000,
  totalCurrentAssets: 80_000 + year * 5_000,
  fixedAssets: 100_000,
  totalAssets: 180_000 + year * 5_000,
  accountsPayable: 15_000,
  shortTermDebt: 5_000,
  totalCurrentLiabilities: 20_000,
  longTermDebt: 400_000 - year * 20_000,
  totalLiabilities: 420_000 - year * 20_000,
  retainedEarnings: 10_000 * year,
  paidInCapital: 55_000,
  totalEquity: 55_000 + 10_000 * year,
  currentRatio: 4,
  debtToEquity: 7,
  workingCapital: 60_000,
}));

async function buildBuffer() {
  return renderProjectionsXlsx({
    dealName: "SMOKE Deal LLC",
    baseYear: { revenue: 1_000_000, cogs: 400_000, operatingExpenses: 300_000, ebitda: 300_000, netIncome: 150_000 },
    annualProjections: [
      { year: 1, revenue: 1_100_000, ebitda: 330_000, dscr: 1.4, totalDebtService: 235_000 },
      { year: 2, revenue: 1_200_000, ebitda: 360_000, dscr: 1.5, totalDebtService: 235_000 },
      { year: 3, revenue: 1_300_000, ebitda: 390_000, dscr: 1.6, totalDebtService: 235_000 },
    ],
    monthlyProjections: [],
    sensitivityScenarios: [
      { name: "base", revenueYear1: 1_100_000, dscrYear1: 1.4 },
      { name: "downside", revenueYear1: 935_000, dscrYear1: 1.1 },
    ],
    sourcesAndUses: SOURCES_AND_USES,
    balanceSheetProjections: BALANCE_SHEET,
  });
}

test("renderProjectionsXlsx: produces a valid, re-readable workbook with 5 sheets", async () => {
  const buf = await buildBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const names = wb.worksheets.map((ws) => ws.name);
  assert.deepEqual(names, ["Annual P&L", "Year 1 Monthly", "Sensitivity", "Sources & Uses", "Balance Sheet"]);
});

test("renderProjectionsXlsx: Sources & Uses is a real table, not a JSON-in-a-cell dump", async () => {
  const buf = await buildBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.getWorksheet("Sources & Uses")!;

  // A JSON dump would be ~2 rows total. A real table with 2 sources + 2 uses
  // + subtotals + the equity injection check section is well over a dozen.
  assert.ok(ws.rowCount > 15, `expected a real table, got only ${ws.rowCount} rows`);

  // No cell anywhere should contain a raw JSON blob.
  let sawJsonDump = false;
  ws.eachRow((row) => {
    row.eachCell((cell) => {
      if (typeof cell.value === "string" && cell.value.trim().startsWith("{")) sawJsonDump = true;
    });
  });
  assert.equal(sawJsonDump, false, "found a JSON-stringified cell — the dump was not actually replaced");

  // Source/use line-item labels appear as real row labels.
  const colAValues = ws.getColumn(1).values.filter((v): v is string => typeof v === "string");
  assert.ok(colAValues.includes("SBA Loan Proceeds"));
  assert.ok(colAValues.includes("Business Acquisition"));

  // Total Sources is a real SUM formula, not a pre-baked static number.
  const totalSourcesRow = ws.getColumn(1).values.findIndex((v) => v === "Total Sources");
  assert.ok(totalSourcesRow > 0, "Total Sources row not found");
  const totalSourcesCell = ws.getCell(totalSourcesRow, 2);
  assert.equal(totalSourcesCell.type, ExcelJS.ValueType.Formula);
  assert.match(String((totalSourcesCell.value as ExcelJS.CellFormulaValue).formula), /^SUM\(/);
});

test("renderProjectionsXlsx: Balance Sheet is a real rows-x-years table with formula subtotals and ratios", async () => {
  const buf = await buildBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.getWorksheet("Balance Sheet")!;

  // Header row: line-item label column + one column per balance-sheet year.
  const header = ws.getRow(1).values as unknown[];
  assert.equal(header[1], "Line Item");
  assert.equal(header[2], "Base Year");
  assert.equal(header[3], "Year 1");
  assert.equal(header[4], "Year 2");
  assert.equal(header[5], "Year 3");

  // 17 line items (BS_ROWS) + header = 18 rows minimum.
  assert.ok(ws.rowCount >= 18, `expected 17 line-item rows + header, got ${ws.rowCount} rows`);

  const totalAssetsRow = ws.getColumn(1).values.findIndex((v) => v === "Total Assets");
  assert.ok(totalAssetsRow > 0, "Total Assets row not found");
  const totalAssetsCell = ws.getCell(totalAssetsRow, 2); // Base Year column
  assert.equal(totalAssetsCell.type, ExcelJS.ValueType.Formula);

  const currentRatioRow = ws.getColumn(1).values.findIndex((v) => v === "Current Ratio");
  assert.ok(currentRatioRow > 0, "Current Ratio row not found");
  const currentRatioCell = ws.getCell(currentRatioRow, 2);
  assert.equal(currentRatioCell.type, ExcelJS.ValueType.Formula);
  assert.match(String((currentRatioCell.value as ExcelJS.CellFormulaValue).formula), /IF\(/);
});

test("renderProjectionsXlsx: gracefully handles missing sources/uses and balance sheet data", async () => {
  const buf = await renderProjectionsXlsx({
    dealName: "No Data Deal",
    baseYear: { revenue: 0, cogs: 0, operatingExpenses: 0, ebitda: 0, netIncome: 0 },
    annualProjections: [],
    monthlyProjections: [],
    sensitivityScenarios: [],
    sourcesAndUses: null,
    balanceSheetProjections: null,
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  assert.equal(wb.worksheets.length, 5);
  const su = wb.getWorksheet("Sources & Uses")!;
  assert.equal(su.getCell(1, 1).value, "Sources & Uses not yet available for this deal.");
});

// Regression: buddy_sba_packages rows generated before sources_and_uses /
// balance_sheet_projections were populated carry `{}` placeholders, not
// null and not the real shape (confirmed via generateTridentBundle.test.ts's
// fixture). Rendering must degrade gracefully, never crash bundle generation.
test("renderProjectionsXlsx: does not crash on legacy `{}` placeholder shapes (not null, not the real shape)", async () => {
  const buf = await renderProjectionsXlsx({
    dealName: "Legacy Placeholder Deal",
    baseYear: { revenue: 0, cogs: 0, operatingExpenses: 0, ebitda: 0, netIncome: 0 },
    annualProjections: [],
    monthlyProjections: [],
    sensitivityScenarios: [],
    sourcesAndUses: {} as unknown as SourcesAndUsesResult,
    balanceSheetProjections: {} as unknown as BalanceSheetYear[],
  });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  assert.equal(wb.worksheets.length, 5);
  const su = wb.getWorksheet("Sources & Uses")!;
  assert.equal(su.getCell(1, 1).value, "Sources & Uses not yet available for this deal.");
  const bs = wb.getWorksheet("Balance Sheet")!;
  assert.equal(bs.getCell(1, 1).value, "Balance sheet projections not yet available for this deal.");
});
