/**
 * Phase 55 — Covenant Rule Configuration
 *
 * Bank policy, version-controlled. Not DB data.
 */

export const COVENANT_RULE_CONFIG = {
  version: "1.0.0",

  dscrFloors: {
    AAA: 1.10, AA: 1.10, A: 1.15,
    BBB: 1.20, BB: 1.20, B: 1.25,
    CCC: 1.30,
  } as Record<string, number>,

  leverageCaps: {
    operating_company: { investment_grade: 3.0, speculative: 4.0 },
    real_estate: { investment_grade: 2.5, speculative: 3.5 },
    mixed_use: { investment_grade: 3.0, speculative: 4.0 },
  } as Record<string, { investment_grade: number; speculative: number }>,

  debtYieldFloors: {
    office: 0.085, retail: 0.090, industrial: 0.080,
    multifamily: 0.075, mixed_use: 0.090, default: 0.085,
  } as Record<string, number>,

  occupancyFloors: {
    office: 0.80, retail: 0.80, industrial: 0.85,
    multifamily: 0.90, mixed_use: 0.80, default: 0.80,
  } as Record<string, number>,

  reportingRequirements: {
    base: ["annual_financials_120d", "annual_guarantor_pfs", "tax_returns"],
    real_estate: ["quarterly_rent_rolls", "annual_appraisal_update"],
    speculative_grade: ["quarterly_financials", "monthly_borrowing_base"],
  },

  springingTriggers: {
    dscrTrigger: 0.10, // floor - 0.10
    occupancyTrigger: 0.10, // floor - 0.10
    leverageTrigger: 0.50, // cap + 0.50
  },
} as const;

export function isInvestmentGrade(grade: string): boolean {
  return ["AAA", "AA", "A", "BBB"].includes(grade.toUpperCase());
}
