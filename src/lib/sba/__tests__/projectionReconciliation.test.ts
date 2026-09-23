import test from "node:test";
import assert from "node:assert/strict";
import { computeSBAProjectionModel } from "../sbaProjectionAuthority";
import { assertProjectionReconciliation } from "../projectionReconciliation";
import { displayProjectionDscr } from "../projectionDisplay";
import { projectionFixture, reconciledStartup } from "./projectionLedger.fixture";

const cents = (n: number) => Math.round(n * 100);

test("saved startup scenario reconciles cash, profit, financed assets and outstanding principal in all three years", () => {
  const model = reconciledStartup();
  assert.doesNotThrow(() => assertProjectionReconciliation(model));
  const y1 = model.annualProjections[0];
  const bs = model.balanceSheetProjections[1];
  assert.equal(cents(y1.interestExpense), 9237709);
  assert.equal(cents(y1.principalRepayment!), 5827475);
  assert.equal(cents(bs.shortTermDebt + bs.longTermDebt), 89172525);
  assert.equal(cents(bs.cash), 41640933);
  assert.equal(cents(bs.fixedAssets), 76000000);
  assert.equal(cents(bs.intangibleAssets!), 4666667);
  assert.equal(bs.paidInCapital, 250000, "opening contribution is not counted a second time");
  assert.equal(model.monthlyProjections[0].financingInflows, 950000);
  assert.equal(model.monthlyProjections[0].capitalExpenditures, 1025000, "working-capital reserve is not spent at closing");
  for (const row of model.balanceSheetProjections) assert.equal(cents(row.totalAssets), cents(row.totalLiabilities + row.totalEquity));
  assert.equal(cents(model.monthlyProjections.reduce((sum, row) => sum + row.taxPayments!, 0)), cents(y1.taxEstimate));
});

test("established business reconciles opening working capital, retained debt, new equity, seller note and later capex", () => {
  const args = projectionFixture();
  args.baseYear.label = "Actual";
  args.baseYear.depreciation = 10000;
  Object.assign(args.openingBalance, { accountsReceivable: 30000, inventory: 20000, fixedAssets: 200000,
    accountsPayable: 10000, longTermDebt: 120000, retainedEarnings: 120000 });
  args.assumptions.loanImpact.existingDebt = [{ description: "Zero-rate note", currentBalance: 120000, monthlyPayment: 10000, remainingTermMonths: 12 }];
  args.assumptions.loanImpact.sellerFinancingAmount = 60000;
  args.assumptions.loanImpact.sellerFinancingRate = .05;
  args.assumptions.loanImpact.sellerFinancingTermMonths = 24;
  args.assumptions.costAssumptions.plannedCapex = [{ year: 1, amount: 950000, description: "Funded asset plan" }, { year: 2, amount: 50000, description: "Expansion" }];
  const model = computeSBAProjectionModel(args);
  assert.doesNotThrow(() => assertProjectionReconciliation(model));
  assert.equal(model.balanceSheetProjections[1].paidInCapital, 500000, "new equity is additive for an operating business");
  assert.equal(model.annualProjections[0].existingDebtService, 120000);
  assert.equal(model.annualProjections[1].existingDebtService, 0);
  assert.equal(model.annualProjections[2].sellerDebtService, 0);
  assert.equal(model.monthlyProjections[0].capitalExpenditures, 1025000, "funded capex is not purchased twice");
});

test("payoff at closing removes exactly the retired debt and preserves retained loan payments", () => {
  const args = projectionFixture();
  args.openingBalance.longTermDebt = 100000;
  args.openingBalance.fixedAssets = 100000;
  args.assumptions.loanImpact.existingDebt = [{ description: "Refinanced note", currentBalance: 100000, monthlyPayment: 10000, remainingTermMonths: 12, treatment: "refinance" }];
  args.useOfProceeds.push({ category: "debt_refinance", description: "Refinanced note", amount: 100000, pctOfTotal: 0 });
  const model = computeSBAProjectionModel(args);
  assert.doesNotThrow(() => assertProjectionReconciliation(model));
  assert.equal(model.annualProjections[0].existingDebtService, 0);
  assert.equal(cents(model.balanceSheetProjections[1].shortTermDebt + model.balanceSheetProjections[1].longTermDebt), 89172525);
  args.useOfProceeds.at(-1)!.amount = 90000;
  assert.throws(() => assertProjectionReconciliation(computeSBAProjectionModel(args)), /payoff uses must match/);
});

test("each revenue stream keeps its own seasonality and December working capital binds to the balance sheet", () => {
  const args = projectionFixture();
  args.assumptions.revenueStreams[0].baseAnnualRevenue = 1000000;
  args.assumptions.revenueStreams[0].seasonalityProfile = [0.5,0.5,0.5,0.5,1,1,1,1,1.5,1.5,1.5,1.5];
  args.assumptions.revenueStreams.push({ ...args.assumptions.revenueStreams[0], id: "second", baseAnnualRevenue: 500000, seasonalityProfile: [1.5,1.5,1.5,1.5,1,1,1,1,0.5,0.5,0.5,0.5] });
  const model = computeSBAProjectionModel(args);
  assert.doesNotThrow(() => assertProjectionReconciliation(model));
  assert.equal(cents(model.monthlyProjections[0].revenue), cents(1250000 / 12));
  assert.equal(model.balanceSheetProjections[1].accountsReceivable, model.monthlyProjections[11].accountsReceivable);
});

test("fully paid loans have zero principal, zero interest and unavailable DSCR instead of phantom debt", () => {
  const args = projectionFixture();
  args.assumptions.loanImpact.termMonths = 6;
  args.assumptions.loanImpact.interestRate = 0;
  const model = computeSBAProjectionModel(args);
  assert.doesNotThrow(() => assertProjectionReconciliation(model));
  assert.equal(cents(model.annualProjections[0].totalDebtService), 95000000);
  assert.equal(model.annualProjections[1].totalDebtService, 0);
  assert.equal(model.balanceSheetProjections[1].longTermDebt, 0);
  assert.equal(displayProjectionDscr(model.annualProjections[1]), "N/A");
});

test("unknown cost allocations, unsupported funding and balloon schedules block admission without inventing balances", () => {
  for (const alter of [
    (args: ReturnType<typeof projectionFixture>) => { args.useOfProceeds[4].description = "Unspecified project purchase"; },
    (args: ReturnType<typeof projectionFixture>) => { args.assumptions.loanImpact.otherSources = [{ description: "Other", amount: 1000 }]; },
    (args: ReturnType<typeof projectionFixture>) => { args.assumptions.loanImpact.existingDebt = [{ description: "Balloon", currentBalance: 100000, monthlyPayment: 1000, remainingTermMonths: 12 }]; },
  ]) {
    const args = projectionFixture(); alter(args);
    assert.throws(() => assertProjectionReconciliation(computeSBAProjectionModel(args)), /financial_input_required/);
  }
});

test("reconciliation rejects independently corrupted income, balance and cash statements", () => {
  const changes = [
    (m: ReturnType<typeof reconciledStartup>) => { m.annualProjections[0].netIncome += 100; },
    (m: ReturnType<typeof reconciledStartup>) => { m.balanceSheetProjections[1].longTermDebt = 0; },
    (m: ReturnType<typeof reconciledStartup>) => { m.balanceSheetProjections[2].retainedEarnings += 100; },
    (m: ReturnType<typeof reconciledStartup>) => { m.monthlyProjections[2].taxPayments = 0; },
    (m: ReturnType<typeof reconciledStartup>) => { m.monthlyProjections[11].cumulativeCash += 500; },
    (m: ReturnType<typeof reconciledStartup>) => { m.annualProjections[0].interestExpense = NaN; },
  ];
  for (const change of changes) {
    const model = structuredClone(reconciledStartup()); change(model);
    assert.throws(() => assertProjectionReconciliation(model), /Projection reconciliation blocked/);
  }
});

test("pre-opening and no-service coverage are N/A, while legitimate high ratios remain numeric", () => {
  const model = reconciledStartup();
  assert.equal(displayProjectionDscr(model.baseYear), "N/A");
  assert.equal(displayProjectionDscr(model.annualProjections[0]), "2.66x");
  assert.equal(displayProjectionDscr({ label: "Actual", totalDebtService: 100, dscr: 100 }), "100.00x");
});
