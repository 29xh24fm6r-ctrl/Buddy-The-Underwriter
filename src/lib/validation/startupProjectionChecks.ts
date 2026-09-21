import type { AnnualProjectionYear } from "@/lib/sba/sbaReadinessTypes";
import type { FinancialPeriod } from "@/lib/modelEngine/types";
import type { ValidationCheck } from "./validationTypes";
import { runCompletenessChecks } from "./completenessChecks";
import { runMathematicalChecks } from "./mathematicalChecks";
import { runPlausibilityChecks } from "./plausibilityChecks";

/** Validate projected coverage and an actual opening balance separately.
 * These local logical names are never written to the historical fact store. */
export function startupProjectionChecks(years: AnnualProjectionYear[], opening: FinancialPeriod["balance"] | null): ValidationCheck[] {
  const checks: ValidationCheck[] = [{ family: "completeness", name: "Pre-opening financial basis", status: "FLAG",
    message: "This business has not opened. Coverage uses borrower-confirmed projections, not historical earnings. Opening balances remain sourced from the financial documents; lender review is required.", severity: "warning" }];
  const balances = { TOTAL_ASSETS: opening?.totalAssets ?? null, TOTAL_LIABILITIES: opening?.totalLiabilities ?? null, NET_WORTH: opening?.equity ?? null };
  if (years.length !== 3) checks.push({ family: "completeness", name: "Three-year startup forecast", status: "BLOCK", message: "Three complete projection years are required.", severity: "error" });
  for (const [index, year] of years.entries()) {
    const projected = { TOTAL_REVENUE: year.revenue, NET_INCOME: year.netIncome, ANNUAL_DEBT_SERVICE: year.totalDebtService, DSCR: year.dscr, CASH_FLOW_AVAILABLE: year.ebitda };
    if (Object.values(projected).some(v => typeof v !== "number" || !Number.isFinite(v)) || year.totalDebtService <= 0) {
      checks.push({ family: "completeness", name: `Projected year ${index + 1} inputs`, status: "BLOCK", message: "Review the confirmed revenue, costs and proposed loan terms. Buddy could not calculate complete projected coverage.", severity: "error" });
      continue;
    }
    checks.push(...[
      ...runCompletenessChecks({ ...projected, ...balances }, "operating_company"),
      ...runMathematicalChecks(projected),
      ...runPlausibilityChecks(projected),
    ].map(c => ({ ...c, name: `Projected year ${index + 1}: ${c.name}`, message: `Forecast, not historical: ${c.message}` })));
  }
  checks.push(...runMathematicalChecks(balances));
  return checks;
}
