import type { SBAProjectionModel } from "./sbaProjectionAuthority";

/** Admission check on the produced statements, independent of their builders.
 * A renderer, model call, or cache cannot turn a failed identity into a pass. */
export function assertProjectionReconciliation(model: SBAProjectionModel): void {
  const blockers = [...(model.accountingBlockers ?? [])];
  const equal = (actual: number, expected: number, name: string) => {
    if (!Number.isFinite(actual) || !Number.isFinite(expected) || Math.abs(actual - expected) > 0.01) blockers.push(name);
  };
  const years = model.annualProjections;
  const months = model.monthlyProjections;
  const balances = model.balanceSheetProjections;
  if (years.length !== 3 || months.length !== 12 || balances.length !== 4) blockers.push("Three forecast years, twelve months and a complete opening balance sheet are required.");
  for (const [i, year] of years.entries()) {
    equal(year.year, i + 1, "Projection years must be complete and ordered.");
    equal(year.grossProfit, year.revenue - year.cogs, `Year ${year.year} gross profit does not reconcile.`);
    equal(year.ebitda, year.grossProfit - year.operatingExpenses, `Year ${year.year} EBITDA does not reconcile.`);
    equal(year.ebit, year.ebitda - year.depreciation, `Year ${year.year} depreciation does not reconcile.`);
    equal(year.netIncome, year.ebit - year.interestExpense - year.taxEstimate, `Year ${year.year} net income omits interest or taxes.`);
    equal(year.totalDebtService, (year.principalRepayment ?? NaN) + year.interestExpense, `Year ${year.year} principal and interest do not reconcile.`);
    equal(year.totalDebtService, (year.existingDebtService ?? NaN) + (year.proposedLoanDebtService ?? NaN) + (year.sellerDebtService ?? NaN), `Year ${year.year} debt-service components differ.`);
    if (year.totalDebtService > 0) equal(year.dscr, year.ebitda / year.totalDebtService, `Year ${year.year} coverage does not reconcile.`);
    const balance = balances[i + 1];
    if (balance) {
      equal(balance.shortTermDebt + balance.longTermDebt, year.endingDebtBalance ?? NaN, `Year ${year.year} debt is missing from the balance sheet.`);
      equal(balance.retainedEarnings, (balances[i]?.retainedEarnings ?? NaN) + year.netIncome, `Year ${year.year} retained earnings do not reconcile.`);
    }
  }
  for (const balance of balances) {
    equal(balance.totalCurrentAssets, balance.cash + balance.accountsReceivable + balance.inventory, `Year ${balance.year} current assets do not reconcile.`);
    equal(balance.totalAssets, balance.totalCurrentAssets + balance.fixedAssets + (balance.intangibleAssets ?? 0), `Year ${balance.year} assets do not reconcile.`);
    equal(balance.totalCurrentLiabilities, balance.accountsPayable + balance.shortTermDebt, `Year ${balance.year} current liabilities do not reconcile.`);
    equal(balance.totalLiabilities, balance.totalCurrentLiabilities + balance.longTermDebt, `Year ${balance.year} liabilities do not reconcile.`);
    equal(balance.totalEquity, balance.paidInCapital + balance.retainedEarnings, `Year ${balance.year} equity does not reconcile.`);
    equal(balance.totalAssets, balance.totalLiabilities + balance.totalEquity, `Year ${balance.year} balance sheet does not balance.`);
  }
  const sum = (key: "revenue" | "debtService" | "taxPayments") => months.reduce((total, month) => total + (month[key] ?? NaN), 0);
  if (years[0]) {
    equal(sum("revenue"), years[0].revenue, "Monthly and annual revenue differ.");
    equal(sum("debtService"), years[0].totalDebtService, "Monthly and annual debt service differ.");
    equal(sum("taxPayments"), years[0].taxEstimate, "Monthly and annual taxes differ.");
    equal(months.reduce((total, m) => total + m.revenue - m.operatingDisbursements + (m.taxPayments ?? NaN), 0), years[0].ebitda, "Monthly and annual operating profit differ.");
  }
  let cash = balances[0]?.cash ?? NaN;
  for (const [i, month] of months.entries()) {
    equal(month.month, i + 1, "Projection months must be complete and ordered.");
    equal(month.netOperatingCF, month.revenue - month.operatingDisbursements - (month.workingCapitalChange ?? NaN), `Month ${month.month} operating cash does not reconcile.`);
    equal(month.netCash, month.netOperatingCF - month.debtService + (month.financingInflows ?? 0) - (month.capitalExpenditures ?? 0), `Month ${month.month} cash movement does not reconcile.`);
    cash += month.netCash;
    equal(month.cumulativeCash, cash, `Month ${month.month} ending cash does not reconcile.`);
  }
  if (balances[1]) {
    equal(balances[1].cash, cash, "Year 1 balance-sheet cash differs from the monthly ledger.");
    const end = months.at(-1);
    for (const key of ["accountsReceivable", "inventory", "accountsPayable"] as const) equal(balances[1][key], end?.[key] ?? NaN, `Year 1 ${key} differs from the monthly ledger.`);
  }
  if (blockers.length) throw new Error(`financial_input_required: Projection reconciliation blocked: ${[...new Set(blockers)].join(" ")}`);
}
