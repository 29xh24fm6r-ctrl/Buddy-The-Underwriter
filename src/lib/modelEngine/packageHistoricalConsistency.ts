import type { FinancialModel } from "./types";
import type { ClassicSpreadInput } from "@/lib/classicSpread/types";

/** Audited historical presentation must agree with the model on the same period/basis. */
export function assertPackageHistoricalConsistency(model: FinancialModel, spread: ClassicSpreadInput) {
  for (const period of model.periods) {
    const index = spread.periods.findIndex(p => {
      const date = new Date(p.date);
      return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === period.periodEnd &&
        (period.type !== "FYE" || p.months === 12);
    });
    if (index < 0) continue;
    const checks = [
      [spread.incomeStatement, "TOTAL REVENUE", period.income.revenue],
      [spread.incomeStatement, "EBITDA", period.cashflow.ebitda],
      [spread.incomeStatement, "NET PROFIT", period.income.netIncome],
      [spread.balanceSheet, "TOTAL ASSETS", period.balance.totalAssets],
    ] as const;
    for (const [rows,label,expected] of checks) {
      const actual = rows.find(r => r.label.trim().toUpperCase() === label)?.values[index];
      // Certification may suppress a figure; preserve that missing-data status.
      if (actual != null && expected != null && Math.abs(actual-expected) > 0.01) {
        throw new Error(`financial_input_required: ${label} for ${period.periodEnd} differs between the accepted historical spread (${actual}) and Model Engine V2 (${expected}); resolve the source conflict before generation`);
      }
    }
  }
}
