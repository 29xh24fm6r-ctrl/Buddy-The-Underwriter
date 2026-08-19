import assert from "node:assert/strict";
import test from "node:test";
import { buildMonthlyProjections } from "../sbaForwardModelBuilder";
import type { AnnualProjectionYear, SBAAssumptions } from "../sbaReadinessTypes";

const assumptions: SBAAssumptions = {
  dealId: "deal-1",
  status: "confirmed",
  revenueStreams: [{
    id: "stream-1",
    name: "Fabrication",
    baseAnnualRevenue: 1_200_000,
    growthRateYear1: 0,
    growthRateYear2: 0,
    growthRateYear3: 0,
    pricingModel: "flat",
    seasonalityProfile: null,
  }],
  costAssumptions: {
    cogsPercentYear1: 0.4,
    cogsPercentYear2: 0.4,
    cogsPercentYear3: 0.4,
    fixedCostCategories: [],
    plannedHires: [],
    plannedCapex: [
      { description: "CNC equipment", amount: 750_000, year: 1 },
      { description: "Year-two expansion", amount: 125_000, year: 2 },
    ],
  },
  workingCapital: { targetDSO: 30, targetDPO: 30, inventoryTurns: null },
  loanImpact: {
    loanAmount: 750_000,
    termMonths: 120,
    interestRate: 0.1,
    existingDebt: [],
    equityInjectionAmount: 100_000,
    equityInjectionSource: "cash_savings",
    sellerFinancingAmount: 50_000,
    sellerFinancingTermMonths: 60,
    sellerFinancingRate: 0.08,
    otherSources: [{ description: "Grant", amount: 25_000 }],
  },
  managementTeam: [{
    name: "Jordan Lee",
    title: "President",
    yearsInIndustry: 15,
    bio: "Jordan leads operations. Jordan has extensive fabrication experience.",
  }],
};

const year1: AnnualProjectionYear = {
  year: 1,
  label: "Projected",
  revenue: 1_200_000,
  cogs: 480_000,
  grossProfit: 720_000,
  grossMarginPct: 0.6,
  operatingExpenses: 360_000,
  ebitda: 360_000,
  depreciation: 0,
  ebit: 360_000,
  interestExpense: 0,
  taxEstimate: 0,
  netIncome: 360_000,
  totalDebtService: 0,
  dscr: 2,
  revenueGrowthPct: 0,
};

test("monthly liquidity includes closing sources and year-one capital uses", () => {
  const months = buildMonthlyProjections(assumptions, year1);
  assert.equal(months.length, 12);
  assert.equal(months[0].financingInflows, 925_000);
  assert.equal(months[0].capitalExpenditures, 750_000);
  assert.equal(months[1].financingInflows, 0);
  assert.equal(months[1].capitalExpenditures, 0);
  assert.equal(
    months[0].netCash,
    months[0].netOperatingCF - months[0].debtService +
      (months[0].financingInflows ?? 0) - (months[0].capitalExpenditures ?? 0),
  );
  assert.equal(
    months[11].cumulativeCash,
    months.reduce((sum, month) => sum + month.netCash, 0),
  );
});


test("monthly liquidity honors canonical uses, exact hire timing, working capital, and debt maturities", () => {
  const exact: SBAAssumptions = {
    ...assumptions,
    costAssumptions: {
      ...assumptions.costAssumptions,
      fixedCostCategories: [{ name: "Rent", annualAmount: 120_000, escalationPctPerYear: 0.03 }],
      plannedHires: [{ role: "Operator", startMonth: 7, annualSalary: 120_000 }],
    },
    loanImpact: {
      ...assumptions.loanImpact,
      existingDebt: [
        { description: "Retained note", currentBalance: 10_000, monthlyPayment: 1_000, remainingTermMonths: 3, treatment: "retain" },
        { description: "Refinanced note", currentBalance: 100_000, monthlyPayment: 5_000, remainingTermMonths: 24, treatment: "refinance" },
      ],
    },
  };
  const uses = [
    { category: "equipment", description: "Equipment", amount: 700_000, pctOfTotal: 0.7 },
    { category: "working_capital", description: "Working capital", amount: 300_000, pctOfTotal: 0.3 },
  ];
  const months = buildMonthlyProjections(exact, year1, uses);
  assert.equal(months[0].capitalExpenditures, 1_000_000);
  assert.equal(months[0].debtService - months[3].debtService, 1_000);
  assert.equal(months[0].operatingDisbursements + 10_000, months[6].operatingDisbursements);
  assert.ok((months[0].workingCapitalChange ?? 0) > 0);
});
