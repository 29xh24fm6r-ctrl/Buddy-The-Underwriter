import "server-only";

/**
 * Projections XLSX generator.
 *
 * Final-mode only — preview borrowers see PDF only. At borrower pick, we
 * deliver the live editable model as XLSX alongside the formatted PDF so
 * the borrower has a working spreadsheet for their own banker conversations.
 */

import ExcelJS from "exceljs";

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
  sourcesAndUses: unknown;
  balanceSheetProjections: unknown;
};

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
  pnl.addRow(["Year", "Revenue", "EBITDA", "Total Debt Service", "DSCR"]);
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
    monthly.addRow(headers);
    for (const m of inputs.monthlyProjections as Array<Record<string, unknown>>) {
      monthly.addRow(headers.map((h) => (m[h] ?? null) as ExcelJS.CellValue));
    }
  }

  // Sheet 3 — Sensitivity.
  const sens = wb.addWorksheet("Sensitivity");
  sens.addRow(["Scenario", "Year 1 Revenue", "Year 1 DSCR"]);
  for (const s of inputs.sensitivityScenarios) {
    sens.addRow([s.name, s.revenueYear1 ?? null, s.dscrYear1 ?? null]);
  }

  // Sheet 4 — Sources & Uses (flattened JSON).
  const sou = wb.addWorksheet("Sources & Uses");
  sou.addRow(["Sources & Uses"]);
  sou.addRow([JSON.stringify(inputs.sourcesAndUses ?? {}, null, 2)]);

  // Sheet 5 — Balance sheet (shape-flexible JSON dump).
  const bs = wb.addWorksheet("Balance Sheet");
  bs.addRow(["Balance Sheet Projections"]);
  bs.addRow([JSON.stringify(inputs.balanceSheetProjections ?? {}, null, 2)]);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}
