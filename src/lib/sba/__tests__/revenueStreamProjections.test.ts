import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRevenueStreamProjections,
  buildAnnualProjections,
  buildBaseYear,
} from "../sbaForwardModelBuilder";
import type { SBAAssumptions } from "../sbaReadinessTypes";

// Auto-dealership multi-stream fixture (the institutional spec example):
// auto sales / service department / tire shop. Each stream has its own
// growth profile so the per-stream output cannot collapse into a single
// blended number without losing information.
const AUTO_DEALER: SBAAssumptions = {
  dealId: "deal-auto-1",
  status: "confirmed",
  revenueStreams: [
    {
      id: "auto_sales",
      name: "Auto Sales",
      baseAnnualRevenue: 4_500_000,
      growthRateYear1: 0.08,
      growthRateYear2: 0.06,
      growthRateYear3: 0.05,
      pricingModel: "per_unit",
      seasonalityProfile: null,
    },
    {
      id: "service_dept",
      name: "Service Department",
      baseAnnualRevenue: 850_000,
      growthRateYear1: 0.12,
      growthRateYear2: 0.1,
      growthRateYear3: 0.08,
      pricingModel: "flat",
      seasonalityProfile: null,
    },
    {
      id: "tire_shop",
      name: "Tire Shop",
      baseAnnualRevenue: 320_000,
      growthRateYear1: 0.15,
      growthRateYear2: 0.12,
      growthRateYear3: 0.1,
      pricingModel: "per_unit",
      seasonalityProfile: null,
    },
  ],
  costAssumptions: {
    cogsPercentYear1: 0.7,
    cogsPercentYear2: 0.7,
    cogsPercentYear3: 0.7,
    fixedCostCategories: [],
    plannedHires: [],
    plannedCapex: [],
  },
  workingCapital: { targetDSO: 30, targetDPO: 30, inventoryTurns: null },
  loanImpact: {
    loanAmount: 500_000,
    termMonths: 120,
    interestRate: 0.0725,
    existingDebt: [],
    equityInjectionAmount: 0,
    equityInjectionSource: "cash_savings",
    sellerFinancingAmount: 0,
    sellerFinancingTermMonths: 0,
    sellerFinancingRate: 0,
    otherSources: [],
  },
  managementTeam: [
    {
      name: "Test Owner",
      title: "CEO",
      ownershipPct: 100,
      yearsInIndustry: 15,
      bio: "Twenty years operating multi-line dealerships in the region.",
    },
  ],
};

test("buildRevenueStreamProjections returns one entry per stream", () => {
  const r = buildRevenueStreamProjections(AUTO_DEALER);
  assert.equal(r.length, 3);
  assert.deepEqual(
    r.map((p) => p.name),
    ["Auto Sales", "Service Department", "Tire Shop"],
  );
});

test("each stream is compounded by its OWN growth rates (not blended)", () => {
  const r = buildRevenueStreamProjections(AUTO_DEALER);

  // Auto Sales: 4,500,000 × 1.08 = 4,860,000 (Y1)
  const auto = r.find((p) => p.id === "auto_sales")!;
  assert.equal(Math.round(auto.revenueYear1), 4_860_000);
  // Y2: 4,860,000 × 1.06 = 5,151,600
  assert.equal(Math.round(auto.revenueYear2), 5_151_600);
  // Y3: 5,151,600 × 1.05 = 5,409,180
  assert.equal(Math.round(auto.revenueYear3), 5_409_180);

  // Service Department: 850,000 × 1.12 = 952,000 (Y1)
  const svc = r.find((p) => p.id === "service_dept")!;
  assert.equal(Math.round(svc.revenueYear1), 952_000);

  // Tire Shop: 320,000 × 1.15 = 368,000 (Y1)
  const tire = r.find((p) => p.id === "tire_shop")!;
  assert.equal(Math.round(tire.revenueYear1), 368_000);
});

test("sum of per-stream revenue equals annualProjections totals (sum invariant)", () => {
  const baseYear = buildBaseYear({
    revenue: 5_670_000, // 4.5M + 850K + 320K
    cogs: 3_969_000,
    operatingExpenses: 1_200_000,
    ebitda: 501_000,
    depreciation: 50_000,
    netIncome: 350_000,
    existingDebtServiceAnnual: 0,
  });
  const totals = buildAnnualProjections(AUTO_DEALER, baseYear);
  const streams = buildRevenueStreamProjections(AUTO_DEALER);

  for (const y of [1, 2, 3] as const) {
    const totalFromStreams = streams.reduce(
      (sum, s) =>
        sum +
        (y === 1
          ? s.revenueYear1
          : y === 2
            ? s.revenueYear2
            : s.revenueYear3),
      0,
    );
    const totalFromAnnual = totals[y - 1].revenue;
    // Allow 0.01 tolerance for floating-point compounding drift.
    assert.ok(
      Math.abs(totalFromStreams - totalFromAnnual) < 0.01,
      `Year ${y}: streams sum ${totalFromStreams} != annual ${totalFromAnnual}`,
    );
  }
});

test("preserves stream identity (id, name, pricingModel)", () => {
  const r = buildRevenueStreamProjections(AUTO_DEALER);
  const auto = r.find((p) => p.id === "auto_sales")!;
  assert.equal(auto.name, "Auto Sales");
  assert.equal(auto.pricingModel, "per_unit");
  assert.equal(auto.baseAnnualRevenue, 4_500_000);
  assert.equal(auto.growthRateYear1, 0.08);
});

test("single-stream deal still produces a one-entry projection", () => {
  const single: SBAAssumptions = {
    ...AUTO_DEALER,
    revenueStreams: [AUTO_DEALER.revenueStreams[0]],
  };
  const r = buildRevenueStreamProjections(single);
  assert.equal(r.length, 1);
  assert.equal(r[0].id, "auto_sales");
});

test("zero-stream deal returns an empty array (no throw)", () => {
  const empty: SBAAssumptions = { ...AUTO_DEALER, revenueStreams: [] };
  const r = buildRevenueStreamProjections(empty);
  assert.equal(r.length, 0);
});

test("proceeds-driven uplift is applied per-stream and matches the totals", () => {
  // When loan proceeds amplify revenue (e.g. equipment online in M3), the
  // uplift must hit each stream and roll up cleanly. The shared formula
  // guarantees this — we lock it down with a regression test.
  const withUplift: SBAAssumptions = {
    ...AUTO_DEALER,
    loanImpact: {
      ...AUTO_DEALER.loanImpact,
      revenueImpactPct: 0.05,
      revenueImpactStartMonth: 3,
    },
  };
  const baseYear = buildBaseYear({
    revenue: 5_670_000,
    cogs: 3_969_000,
    operatingExpenses: 1_200_000,
    ebitda: 501_000,
    depreciation: 50_000,
    netIncome: 350_000,
    existingDebtServiceAnnual: 0,
  });
  const totals = buildAnnualProjections(withUplift, baseYear);
  const streams = buildRevenueStreamProjections(withUplift);

  const sumY1 = streams.reduce((s, p) => s + p.revenueYear1, 0);
  assert.ok(
    Math.abs(sumY1 - totals[0].revenue) < 0.01,
    `uplift Y1: ${sumY1} vs ${totals[0].revenue}`,
  );
});
