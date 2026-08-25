import assert from "node:assert/strict";
import test from "node:test";
import { buildBalanceSheetProjections } from "../sbaBalanceSheetProjector";

test("Year-1 projected cash uses the authoritative monthly ending balance", () => {
  const assumptions = {
    workingCapital: { targetDSO: 30, targetDPO: 30, inventoryTurns: 6 },
    costAssumptions: { plannedCapex: [{ year: 1, amount: 750_000 }] },
    loanImpact: { loanAmount: 850_000, termMonths: 120, interestRate: 0.105 },
  } as any;
  const annual = [
    {
      year: 1,
      revenue: 2_753_880,
      cogs: 1_514_634,
      netIncome: 151_122,
      depreciation: 240_000,
    },
  ] as any;
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

  const rows = buildBalanceSheetProjections(assumptions, annual, base, {
    year1EndingCash: 12_419.52,
  });

  assert.equal(rows[1]?.cash, 12_419.52);
});

test("later projected years continue rolling forward from the bound Year-1 cash", () => {
  const assumptions = {
    workingCapital: { targetDSO: 0, targetDPO: 0, inventoryTurns: 0 },
    costAssumptions: { plannedCapex: [] },
    loanImpact: { loanAmount: 0, termMonths: 0, interestRate: 0 },
  } as any;
  const annual = [
    { year: 1, revenue: 0, cogs: 0, netIncome: 100, depreciation: 0 },
    { year: 2, revenue: 0, cogs: 0, netIncome: 50, depreciation: 0 },
  ] as any;
  const base = {
    cash: 1_000,
    accountsReceivable: 0,
    inventory: 0,
    fixedAssets: 0,
    accountsPayable: 0,
    shortTermDebt: 0,
    longTermDebt: 0,
    paidInCapital: 0,
    retainedEarnings: 1_000,
  };

  const rows = buildBalanceSheetProjections(assumptions, annual, base, {
    year1EndingCash: 900,
  });

  assert.equal(rows[1]?.cash, 900);
  assert.equal(rows[2]?.cash, 950);
});
