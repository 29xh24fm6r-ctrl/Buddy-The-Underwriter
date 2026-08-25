import assert from "node:assert/strict";
import test from "node:test";

import { buildBalanceSheetProjections } from "../sbaBalanceSheetProjector";
import type { AnnualProjectionYear, MonthlyProjection, SBAAssumptions } from "../sbaReadinessTypes";

const assumptions = {
  workingCapital: { targetDSO: 42, targetDPO: 30, inventoryTurns: 7 },
  costAssumptions: { plannedCapex: [{ year: 1, amount: 750_000 }] },
  loanImpact: {
    loanAmount: 850_000,
    termMonths: 120,
    interestRate: 0.105,
  },
} as unknown as SBAAssumptions;

const year1 = {
  year: 1,
  label: "Projected",
  revenue: 2_700_000,
  cogs: 1_485_000,
  netIncome: 250_000,
  depreciation: 240_000,
} as AnnualProjectionYear;

const base = {
  cash: 240_000,
  accountsReceivable: 310_000,
  inventory: 180_000,
  fixedAssets: 950_000,
  accountsPayable: 210_000,
  shortTermDebt: 0,
  longTermDebt: 620_000,
  paidInCapital: 0,
  retainedEarnings: 850_000,
};

test("Year 1 balance-sheet cash is bound to the canonical monthly liquidity ledger", () => {
  const monthly = Array.from({ length: 12 }, (_, index) => ({
    month: index + 1,
    cumulativeCash: index === 11 ? -227_580.48 : 0,
  })) as MonthlyProjection[];
  const expectedEndingCash = base.cash + monthly[11].cumulativeCash;

  const result = buildBalanceSheetProjections(assumptions, [year1], base, {
    year1EndingCash: expectedEndingCash,
  });

  // Monetary equality is governed at cent precision; binary floating-point
  // addition may represent 12,419.52 as 12,419.51999999999.
  assert.equal(Math.round(result[1].cash * 100), 1_241_952);
  assert.equal(Math.round(result[1].cash * 100), Math.round(expectedEndingCash * 100));
});

test("legacy callers without an authoritative ending cash retain the annual roll-forward", () => {
  const result = buildBalanceSheetProjections(assumptions, [year1], base);

  assert.ok(Number.isFinite(result[1].cash));
  assert.notEqual(Math.round(result[1].cash * 100), Math.round((base.cash - 227_580.48) * 100));
});
