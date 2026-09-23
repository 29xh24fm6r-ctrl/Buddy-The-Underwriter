// src/lib/sba/sbaBalanceSheetProjector.ts
// Phase BPG — Projected balance sheet builder (3-year).
// Pure function: activates the dead DSO/DPO/inventory turn fields from
// SBAAssumptions.workingCapital and produces a forward balance sheet aligned
// with the annual projections + loan amortization.

import type {
  AnnualProjectionYear,
  SBAAssumptions,
  MonthlyProjection,
} from "./sbaReadinessTypes";
import { buildProjectionLedger, debtYear, type ProjectionLedger } from "./sbaProjectionLedger";

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
  intangibleAssets?: number;
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

export function buildBalanceSheetProjections(
  assumptions: SBAAssumptions,
  annualProjections: AnnualProjectionYear[],
  baseYear: BalanceSheetBaseYearInputs,
  options: { year1EndingCash?: number; year1EndingWorkingCapital?: MonthlyProjection; ledger?: ProjectionLedger } = {},
): BalanceSheetYear[] {
  const { workingCapital } = assumptions;
  const ledger = options.ledger ?? buildProjectionLedger({ assumptions, opening: baseYear });
  const unscheduledDebt = baseYear.shortTermDebt + baseYear.longTermDebt -
    (assumptions.loanImpact.existingDebt ?? []).reduce((sum, debt) => sum + debt.currentBalance, 0);
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
    intangibleAssets: 0,
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

    const yearIdx = (i + 1) as 1 | 2 | 3;
    const monthlyEnd = yearIdx === 1 ? options.year1EndingWorkingCapital : undefined;
    const ar = monthlyEnd?.accountsReceivable ?? (dso > 0 ? (y.revenue / 365) * dso : 0);
    const inventory = monthlyEnd?.inventory ?? (invTurns && invTurns > 0 ? y.cogs / invTurns : prev.inventory + (yearIdx === 1 ? ledger.closing.inventory : 0));
    const ap = monthlyEnd?.accountsPayable ?? (dpo > 0 ? (y.cogs / 365) * dpo : 0);
    const assets = ledger.assets[i];
    const debt = debtYear(ledger, yearIdx);
    const principalPayments = debt.principal;
    const capexThisYear = assets.capex;

    // Change in working capital (excluding cash): AR + inventory - AP vs prev
    const prevNonCashWC =
      prev.accountsReceivable + prev.inventory - prev.accountsPayable;
    const currNonCashWC = ar + inventory - ap;
    const changeInWC = currNonCashWC - prevNonCashWC;

    const rolledCash =
      prev.cash + y.netIncome + y.depreciation - changeInWC - principalPayments - capexThisYear +
      (yearIdx === 1 ? ledger.closing.inflows - ledger.closing.intangibleAssets - ledger.closing.debtRetired : 0);
    // Year 1 has a detailed monthly liquidity schedule that already includes
    // closing sources, closing uses, debt service, and working-capital timing.
    // When supplied, it is the authoritative Year-1 cash balance; recomputing
    // cash independently here creates contradictory borrower-facing artifacts.
    const cash = yearIdx === 1 && Number.isFinite(options.year1EndingCash)
      ? options.year1EndingCash!
      : rolledCash;

    const fixedAssets = assets.fixedAssets;
    const intangibleAssets = assets.intangibleAssets;

    const totalCurrent = cash + ar + inventory;
    const totalAssets = totalCurrent + fixedAssets + intangibleAssets;

    const shortTermDebt = debt.currentPortion;
    const totalCurrentLiab = ap + shortTermDebt;

    const longTermDebt = Math.max(0, debt.balance - shortTermDebt) + unscheduledDebt;
    const totalLiab = totalCurrentLiab + longTermDebt;

    const retainedEarnings = prev.retainedEarnings + y.netIncome;
    const paidInCapital = prev.paidInCapital + (yearIdx === 1 ? ledger.closing.equityAdded : 0);
    const totalEquity = retainedEarnings + paidInCapital;

    rows.push({
      year: yearIdx,
      label: "Projected",
      cash,
      accountsReceivable: ar,
      inventory,
      totalCurrentAssets: totalCurrent,
      fixedAssets,
      intangibleAssets,
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
