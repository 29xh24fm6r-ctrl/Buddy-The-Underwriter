import { buildBaseYear } from "../sbaForwardModelBuilder";
import { computeSBAProjectionModel } from "../sbaProjectionAuthority";
import type { SBAAssumptions, UseOfProceedsLine } from "../sbaReadinessTypes";

/** Synthetic startup values from the saved no-AI QA replay. No identity data. */
export function projectionFixture() {
  const assumptions: SBAAssumptions = {
    dealId: "projection-test", status: "confirmed",
    revenueStreams: [{ id: "coffee", name: "Coffee", pricingModel: "flat", baseAnnualRevenue: 1500000,
      growthRateYear1: 0, growthRateYear2: .05, growthRateYear3: .05, seasonalityProfile: null }],
    costAssumptions: { cogsPercentYear1: .3, cogsPercentYear2: .3, cogsPercentYear3: .3,
      fixedCostCategories: [{ name: "Operating costs", annualAmount: 650000, escalationPctPerYear: .03 }], plannedHires: [], plannedCapex: [] },
    workingCapital: { targetDSO: 1, targetDPO: 15, inventoryTurns: 24 },
    loanImpact: { loanAmount: 950000, termMonths: 120, interestRate: .1, existingDebt: [],
      equityInjectionAmount: 250000, equityInjectionSource: "cash_savings", sellerFinancingAmount: 0,
      sellerFinancingRate: 0, sellerFinancingTermMonths: 0, otherSources: [] },
    managementTeam: [],
  };
  const baseYear = buildBaseYear({ revenue: 0, cogs: 0, operatingExpenses: 0, ebitda: 0, depreciation: 0, netIncome: 0, existingDebtServiceAnnual: 0 });
  baseYear.label = "Pre-opening";
  const openingBalance = { cash: 250000, accountsReceivable: 0, inventory: 0, fixedAssets: 0,
    accountsPayable: 0, shortTermDebt: 0, longTermDebt: 0, paidInCapital: 250000, retainedEarnings: 0 };
  const useOfProceeds: UseOfProceedsLine[] = [
    { category: "working_capital", description: "Opening reserves", amount: 175000, pctOfTotal: 175000/1200000 },
    { category: "inventory", description: "Opening inventory", amount: 25000, pctOfTotal: 25000/1200000 },
    { category: "equipment", description: "Coffee equipment", amount: 350000, pctOfTotal: 350000/1200000 },
    { category: "purchase_or_construction", description: "Leasehold buildout", amount: 600000, pctOfTotal: .5 },
    { category: "other", description: "Initial franchise fee", amount: 50000, pctOfTotal: 50000/1200000 },
  ];
  return { assumptions, baseYear, openingBalance, useOfProceeds };
}

export function reconciledStartup() { return computeSBAProjectionModel(projectionFixture()); }
