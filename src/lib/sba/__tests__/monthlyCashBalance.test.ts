import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBaseYear,
  buildAnnualProjections,
  buildMonthlyProjections,
  buildUseOfProceeds,
} from "../sbaForwardModelBuilder";
import type { SBAAssumptions } from "../sbaReadinessTypes";

/**
 * Built from the real QA fixture deal as it exists in production
 * (d4b7104f-7f4b-4ae8-ac39-c2dbbdad3562): its confirmed assumptions and its
 * governed deal_financial_facts, both read from the live database rather than
 * invented for this test. That matters, because the defect only showed itself
 * at realistic magnitudes.
 *
 * monthlyProjections[].cumulativeCash started at zero while two consumers read
 * it incompatibly: the orchestrator added the opening balance back for the
 * balance sheet (treating it as a net change), and the business-plan renderer
 * printed it verbatim as "a cumulative cash position of $X" (a balance). With
 * $240,000 of governed cash on hand, the published plan told lenders this
 * borrower's cash bottomed at about -$140,000 and spent ten of twelve months
 * underwater. It never goes below roughly +$100,000. The AI reviewer rejected
 * the plan with "The arithmetic is inconsistent" — it was right.
 */

const FACTS = {
  TOTAL_REVENUE: 2_400_000,
  COST_OF_GOODS_SOLD: 1_320_000,
  TOTAL_OPERATING_EXPENSES: 720_000,
  EBITDA: 360_000,
  DEPRECIATION: 90_000,
  NET_INCOME: 190_000,
  ADS: 120_000,
  CASH: 240_000,
} as const;

function fixtureAssumptions(): SBAAssumptions {
  return {
    dealId: "d4b7104f-7f4b-4ae8-ac39-c2dbbdad3562",
    status: "confirmed",
    revenueStreams: [
      { id: "precision-machining", name: "Precision machining", pricingModel: "per_unit",
        baseAnnualRevenue: 1_800_000, growthRateYear1: 0.09, growthRateYear2: 0.07,
        growthRateYear3: 0.06, seasonalityProfile: null },
      { id: "fabrication-repair", name: "Fabrication and repair", pricingModel: "flat",
        baseAnnualRevenue: 600_000, growthRateYear1: 0.06, growthRateYear2: 0.05,
        growthRateYear3: 0.04, seasonalityProfile: null },
    ],
    costAssumptions: {
      cogsPercentYear1: 0.55, cogsPercentYear2: 0.545, cogsPercentYear3: 0.54,
      plannedCapex: [{ year: 1, amount: 750_000, description: "Five-axis machining center and tooling" }],
      plannedHires: [
        { role: "Second-shift CNC operator", startMonth: 4, annualSalary: 65_000 },
        { role: "Quality technician", startMonth: 7, annualSalary: 58_000 },
      ],
      fixedCostCategories: [
        { name: "Payroll and benefits", annualAmount: 430_000, escalationPctPerYear: 0.03 },
        { name: "Occupancy and utilities", annualAmount: 150_000, escalationPctPerYear: 0.025 },
        { name: "Insurance, software, and administration", annualAmount: 140_000, escalationPctPerYear: 0.03 },
      ],
    },
    workingCapital: { targetDSO: 42, targetDPO: 30, inventoryTurns: 7 },
    loanImpact: {
      loanAmount: 850_000, termMonths: 120, interestRate: 0.105,
      equityInjectionAmount: 150_000, equityInjectionSource: "cash_savings",
      sellerFinancingAmount: 0, sellerFinancingRate: 0, sellerFinancingTermMonths: 0,
      otherSources: [], revenueImpactPct: 0.08, revenueImpactStartMonth: 4,
      revenueImpactDescription: "New five-axis capacity converts documented overflow demand.",
      existingDebt: [{ description: "Existing equipment notes", currentBalance: 620_000,
                       monthlyPayment: 10_000, remainingTermMonths: 72 }],
    },
    managementTeam: [
      { name: "Jordan Ellis", title: "Founder and President", ownershipPct: 100,
        yearsInIndustry: 17, bio: "Seventeen years of machining and plant operations." },
    ],
  } as unknown as SBAAssumptions;
}

function monthsFor(openingCash: number) {
  const a = fixtureAssumptions();
  const baseYear = buildBaseYear({
    revenue: FACTS.TOTAL_REVENUE, cogs: FACTS.COST_OF_GOODS_SOLD,
    operatingExpenses: FACTS.TOTAL_OPERATING_EXPENSES, ebitda: FACTS.EBITDA,
    depreciation: FACTS.DEPRECIATION, netIncome: FACTS.NET_INCOME,
    existingDebtServiceAnnual: FACTS.ADS,
  });
  const year1 = buildAnnualProjections(a, baseYear)[0];
  const uop = buildUseOfProceeds(
    [{ category: "equipment", description: "Five-axis machining center and tooling", amount: 750_000 }],
    850_000,
  );
  return buildMonthlyProjections(a, year1, uop, openingCash);
}

test("[cash] the monthly series is a balance seeded from cash on hand", () => {
  const months = monthsFor(FACTS.CASH);
  assert.equal(months.length, 12);
  // Month 1 opens from the governed balance, not from zero.
  assert.ok(
    months[0].cumulativeCash > FACTS.CASH - 1_000_000,
    "month 1 must be computed from the opening balance",
  );
  // The whole-year identity: ending balance = opening cash + sum of net cash.
  const netSum = months.reduce((s, m) => s + m.netCash, 0);
  assert.ok(
    Math.abs(months[11].cumulativeCash - (FACTS.CASH + netSum)) < 0.01,
    "ending balance must equal opening cash plus the year's net cash movement",
  );
});

test("[cash] this borrower is never shown as out of cash", () => {
  // The published plan claimed ten underwater months and a -$139,641.76
  // trough. Both were artifacts of starting the series at zero.
  const months = monthsFor(FACTS.CASH);
  const negative = months.filter((m) => m.cumulativeCash < 0);
  assert.deepEqual(
    negative.map((m) => m.month),
    [],
    "no month may read negative for a borrower holding $240,000 in cash",
  );
  const trough = Math.min(...months.map((m) => m.cumulativeCash));
  assert.ok(trough > 100_000, `tightest month should clear $100k, got ${trough.toFixed(2)}`);
});

test("[cash] omitting opening cash is exactly the old, wrong series", () => {
  // Pins the size of the error so a regression is unmistakable rather than
  // subtle: every month differs by precisely the opening balance.
  const seeded = monthsFor(FACTS.CASH);
  const unseeded = monthsFor(0);
  seeded.forEach((m, i) => {
    assert.ok(
      Math.abs(m.cumulativeCash - unseeded[i].cumulativeCash - FACTS.CASH) < 0.01,
      `month ${m.month} must differ from the unseeded series by exactly the opening balance`,
    );
  });
  assert.ok(
    unseeded.filter((m) => m.cumulativeCash < 0).length >= 10,
    "the unseeded series is the one that showed ten underwater months",
  );
});

test("[cash] a missing or non-finite opening balance degrades to zero, not NaN", () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
    const months = monthsFor(bad as number);
    assert.ok(
      months.every((m) => Number.isFinite(m.cumulativeCash)),
      "a bad opening balance must not poison every downstream figure",
    );
  }
  const defaulted = buildMonthlyProjections(
    fixtureAssumptions(),
    buildAnnualProjections(fixtureAssumptions(), buildBaseYear({
      revenue: FACTS.TOTAL_REVENUE, cogs: FACTS.COST_OF_GOODS_SOLD,
      operatingExpenses: FACTS.TOTAL_OPERATING_EXPENSES, ebitda: FACTS.EBITDA,
      depreciation: FACTS.DEPRECIATION, netIncome: FACTS.NET_INCOME,
      existingDebtServiceAnnual: FACTS.ADS,
    }))[0],
    [],
  );
  assert.ok(defaulted.every((m) => Number.isFinite(m.cumulativeCash)));
});
