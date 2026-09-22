import type { AnnualProjectionYear } from "@/lib/sba/sbaReadinessTypes";
import type { FinancialPeriod } from "@/lib/modelEngine/types";
import type { FinancialRow } from "./types";
import { startupProjectionChecks } from "@/lib/validation/startupProjectionChecks";

/** Presentation of the immutable package model, never historical fact writes. */
export type StartupSpread = {
  businessStage: "pre_opening";
  confirmedAt: string;
  openingDate: string;
  openingBalance: FinancialPeriod["balance"];
  projections: AnnualProjectionYear[];
};

export function startupSpreadBlockers(input: StartupSpread): string[] {
  if (input.businessStage !== "pre_opening" || !input.confirmedAt ||
      !Number.isFinite(Date.parse(input.confirmedAt)) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.openingDate) || !Number.isFinite(Date.parse(input.openingDate)) || input.openingDate === "1900-01-01") {
    return ["Confirmed startup assumptions and a dated opening balance sheet are required."];
  }
  const opening = input.openingBalance;
  if (!opening || [opening.cash, opening.totalAssets, opening.totalLiabilities, opening.equity]
    .some(value => typeof value !== "number" || !Number.isFinite(value))) {
    return ["Complete the opening balance sheet."];
  }
  const years = input.projections;
  if (!Array.isArray(years) || years.length !== 3 || years.some((year, index) =>
    year.year !== index + 1 || year.label !== "Projected" ||
    [year.revenue, year.cogs, year.grossProfit, year.operatingExpenses, year.ebitda,
      year.depreciation, year.ebit, year.interestExpense, year.taxEstimate, year.netIncome,
      year.totalDebtService, year.dscr].some(value => typeof value !== "number" || !Number.isFinite(value)))) {
    return ["Three complete, explicitly projected years are required."];
  }
  return startupProjectionChecks(years, opening).filter(check => check.status === "BLOCK").map(check => check.message);
}

const row = (label: string, values: (number | null)[]): FinancialRow =>
  ({ label, values, indent: 0, isBold: false, showPct: false });

/** Copy model outputs without calculating a second set of financials. */
export function startupOpeningRows(input: StartupSpread): FinancialRow[] {
  const fields: [string, keyof FinancialPeriod["balance"]][] = [
    ["Cash", "cash"], ["Accounts receivable", "accountsReceivable"], ["Inventory", "inventory"],
    ["Net fixed assets", "netFixedAssets"], ["Total assets", "totalAssets"],
    ["Accounts payable", "accountsPayable"], ["Short-term debt", "shortTermDebt"],
    ["Long-term debt", "longTermDebt"], ["Total liabilities", "totalLiabilities"], ["Equity", "equity"],
  ];
  return fields.map(([label, key]) => row(label, [typeof input.openingBalance[key] === "number" ? input.openingBalance[key] as number : null]));
}

export function startupProjectionRows(input: StartupSpread): FinancialRow[] {
  const fields: [string, keyof AnnualProjectionYear][] = [
    ["Revenue", "revenue"], ["Cost of goods sold", "cogs"], ["Gross profit", "grossProfit"],
    ["Operating expenses", "operatingExpenses"], ["EBITDA", "ebitda"], ["Depreciation", "depreciation"],
    ["EBIT", "ebit"], ["Interest expense", "interestExpense"], ["Estimated taxes", "taxEstimate"],
    ["Net income", "netIncome"], ["Total annual debt service", "totalDebtService"],
  ];
  return fields.map(([label, key]) => row(label, input.projections.map(year => year[key] as number)));
}
