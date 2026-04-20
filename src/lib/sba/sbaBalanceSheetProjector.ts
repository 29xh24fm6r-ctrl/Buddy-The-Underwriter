// src/lib/sba/sbaBalanceSheetProjector.ts
// Phase BPG — Projected balance sheet builder (3-year).
// Pure function: activates the dead DSO/DPO/inventory turn fields from
// SBAAssumptions.workingCapital and produces a forward balance sheet aligned
// with the annual projections + loan amortization.

import type {
  AnnualProjectionYear,
  SBAAssumptions,
} from "./sbaReadinessTypes";

export interface BalanceSheetYear {
  year: 0 | 1 | 2 | 3;
  label: "Actual" | "Projected";
  // Current assets
  cash: number;
  accountsReceivable: number;
  inventory: number;
  totalCurrentAssets: number;
  // Non-current
  fixedAssets: number;
  totalAssets: number;
  // Current liabilities
  accountsPayable: number;
  shortTermDebt: number;
  totalCurrentLiabilities: number;
  // Non-current liabilities
  longTermDebt: number;
  totalLiabilities: number;
  // Equity
  retainedEarnings: number;
  paidInCapital: number;
  totalEquity: number;
  // Ratios
  currentRatio: number;
  debtToEquity: number;
  workingCapital: number;
}

export interface BalanceSheetBaseYearInputs {
  cash: number;
  accountsReceivable: number;
  inventory: number;
  fixedAssets: number;
  accountsPayable: number;
  shortTermDebt: number;
  longTermDebt: number;
  paidInCapital: number;
  retainedEarnings: number;
}

function safeDiv(num: number, den: number): number {
  if (!Number.isFinite(den) || den === 0) return 0;
  return num / den;
}

function annualPrincipalAmortization(
  loanAmount: number,
  termMonths: number,
  interestRate: number,
  year: 1 | 2 | 3,
): number {
  // True amortization schedule for a single year's principal reduction.
  // annual rate -> monthly; PMT formula.
  if (loanAmount <= 0 || termMonths <= 0) return 0;
  const i = interestRate / 12;
  const n = termMonths;
  if (i === 0) {
    const monthly = loanAmount / n;
    const monthsInYear = Math.min(12, Math.max(0, n - (year - 1) * 12));
    return monthly * monthsInYear;
  }
  const pmt = (loanAmount * i) / (1 - Math.pow(1 + i, -n));
  // Simulate principal paid in the target year
  let balance = loanAmount;
  let principalPaid = 0;
  const startMonth = (year - 1) * 12 + 1;
  const endMonth = Math.min(year * 12, n);
  for (let m = 1; m <= n; m++) {
    const interest = balance * i;
    const principal = pmt - interest;
    if (m >= startMonth && m <= endMonth) {
      principalPaid += principal;
    }
    balance -= principal;
    if (balance < 0) balance = 0;
  }
  return Math.max(0, principalPaid);
}

export function buildBalanceSheetProjections(
  assumptions: SBAAssumptions,
  annualProjections: AnnualProjectionYear[],
  baseYear: BalanceSheetBaseYearInputs,
): BalanceSheetYear[] {
  const { workingCapital, costAssumptions, loanImpact } = assumptions;
  const dso = workingCapital.targetDSO || 0;
  const dpo = workingCapital.targetDPO || 0;
  const invTurns = workingCapital.inventoryTurns;

  // Base year (Actual) row
  const baseCurrent =
    baseYear.cash + baseYear.accountsReceivable + baseYear.inventory;
  const baseCurrentLiab = baseYear.accountsPayable + baseYear.shortTermDebt;
  const baseTotalLiab = baseCurrentLiab + baseYear.longTermDebt;
  const baseTotalEquity = baseYear.paidInCapital + baseYear.retainedEarnings;

  const year0: BalanceSheetYear = {
    year: 0,
    label: "Actual",
    cash: baseYear.cash,
    accountsReceivable: baseYear.accountsReceivable,
    inventory: baseYear.inventory,
    totalCurrentAssets: baseCurrent,
    fixedAssets: baseYear.fixedAssets,
    totalAssets: baseCurrent + baseYear.fixedAssets,
    accountsPayable: baseYear.accountsPayable,
    shortTermDebt: baseYear.shortTermDebt,
    totalCurrentLiabilities: baseCurrentLiab,
    longTermDebt: baseYear.longTermDebt,
    totalLiabilities: baseTotalLiab,
    retainedEarnings: baseYear.retainedEarnings,
    paidInCapital: baseYear.paidInCapital,
    totalEquity: baseTotalEquity,
    currentRatio: safeDiv(baseCurrent, baseCurrentLiab),
    debtToEquity: safeDiv(baseTotalLiab, baseTotalEquity),
    workingCapital: baseCurrent - baseCurrentLiab,
  };

  const rows: BalanceSheetYear[] = [year0];

  // Project years 1-3
  for (let i = 0; i < Math.min(3, annualProjections.length); i++) {
    const y = annualProjections[i];
    const prev = rows[i];

    const ar = dso > 0 ? (y.revenue / 365) * dso : 0;
    const inventory = invTurns && invTurns > 0 ? y.cogs / invTurns : 0;
    const ap = dpo > 0 ? (y.cogs / 365) * dpo : 0;

    // Capex for the year
    const yearIdx = (i + 1) as 1 | 2 | 3;
    const capexThisYear = (costAssumptions.plannedCapex ?? [])
      .filter((c) => c.year === yearIdx)
      .reduce((s, c) => s + (c.amount || 0), 0);

    const principalPayments = annualPrincipalAmortization(
      loanImpact.loanAmount,
      loanImpact.termMonths,
      loanImpact.interestRate,
      yearIdx,
    );

    // Change in working capital (excluding cash): AR + inventory - AP vs prev
    const prevNonCashWC =
      prev.accountsReceivable + prev.inventory - prev.accountsPayable;
    const currNonCashWC = ar + inventory - ap;
    const changeInWC = currNonCashWC - prevNonCashWC;

    const cash =
      prev.cash + y.netIncome + y.depreciation - changeInWC - principalPayments - capexThisYear;

    const fixedAssets = prev.fixedAssets + capexThisYear - y.depreciation;

    const totalCurrent = cash + ar + inventory;
    const totalAssets = totalCurrent + Math.max(0, fixedAssets);

    const shortTermDebt = prev.shortTermDebt; // assume steady
    const totalCurrentLiab = ap + shortTermDebt;

    const longTermDebt = Math.max(0, prev.longTermDebt - principalPayments);
    const totalLiab = totalCurrentLiab + longTermDebt;

    const retainedEarnings = prev.retainedEarnings + y.netIncome;
    const paidInCapital = prev.paidInCapital;
    const totalEquity = retainedEarnings + paidInCapital;

    rows.push({
      year: yearIdx,
      label: "Projected",
      cash,
      accountsReceivable: ar,
      inventory,
      totalCurrentAssets: totalCurrent,
      fixedAssets: Math.max(0, fixedAssets),
      totalAssets,
      accountsPayable: ap,
      shortTermDebt,
      totalCurrentLiabilities: totalCurrentLiab,
      longTermDebt,
      totalLiabilities: totalLiab,
      retainedEarnings,
      paidInCapital,
      totalEquity,
      currentRatio: safeDiv(totalCurrent, totalCurrentLiab),
      debtToEquity: safeDiv(totalLiab, totalEquity),
      workingCapital: totalCurrent - totalCurrentLiab,
    });
  }

  return rows;
}
