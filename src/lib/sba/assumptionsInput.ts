import { z } from "zod";

const amount = z.number().finite().nonnegative();
const rate = z.number().finite().min(0).max(1);
const growth = z.number().finite().min(-0.5).max(2);
const text = z.string().max(12000);
// Shared input contract for the existing model, not a second calculator.
export const assumptionsInput = z.object({
  revenueStreams: z
    .array(
      z.object({
        id: text,
        name: text,
        baseAnnualRevenue: amount,
        growthRateYear1: growth,
        growthRateYear2: growth,
        growthRateYear3: growth,
        pricingModel: z.enum([
          "flat",
          "per_unit",
          "subscription",
          "pct_revenue",
        ]),
        seasonalityProfile: z
          .array(amount)
          .length(12)
          .refine(
            (v) => Math.abs(v.reduce((a, b) => a + b, 0) - 12) < 0.001,
            "Seasonality weights must total 12",
          )
          .nullable(),
      }),
    )
    .max(30),
  costAssumptions: z.object({
    cogsPercentYear1: rate,
    cogsPercentYear2: rate,
    cogsPercentYear3: rate,
    fixedCostCategories: z
      .array(
        z.object({
          name: text,
          annualAmount: amount,
          escalationPctPerYear: growth,
        }),
      )
      .max(100),
    plannedHires: z
      .array(
        z.object({
          role: text,
          startMonth: z.number().int().min(1).max(36),
          annualSalary: amount,
        }),
      )
      .max(100),
    plannedCapex: z
      .array(
        z.object({
          description: text,
          amount,
          year: z.union([z.literal(1), z.literal(2), z.literal(3)]),
        }),
      )
      .max(100),
  }),
  workingCapital: z.object({
    targetDSO: amount.max(365),
    targetDPO: amount.max(365),
    inventoryTurns: amount.nullable(),
  }),
  loanImpact: z.object({
    loanAmount: amount,
    termMonths: z.number().int().min(0).max(360),
    interestRate: rate,
    existingDebt: z
      .array(
        z.object({
          description: text,
          currentBalance: amount,
          monthlyPayment: amount,
          remainingTermMonths: z.number().int().nonnegative(),
          treatment: z.enum(["retain", "refinance", "payoff"]).optional(),
        }),
      )
      .max(100),
    revenueImpactStartMonth: z.number().int().min(1).max(36).optional(),
    revenueImpactPct: growth.optional(),
    revenueImpactDescription: text.optional(),
    equityInjectionAmount: amount,
    equityInjectionSource: z.enum([
      "cash_savings",
      "401k_rollover",
      "gift",
      "other",
    ]),
    sellerFinancingAmount: amount,
    sellerFinancingTermMonths: z.number().int().nonnegative(),
    sellerFinancingRate: rate,
    otherSources: z.array(z.object({ description: text, amount })).max(100),
  }),
  managementTeam: z
    .array(
      z.object({
        name: text,
        title: text,
        ownershipPct: amount.max(100).optional(),
        yearsInIndustry: amount.max(100),
        bio: text,
      }),
    )
    .max(100),
});
