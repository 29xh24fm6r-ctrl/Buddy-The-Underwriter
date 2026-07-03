/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 9: CRE / NOI / Property Intelligence.
 *
 * Property-level underwriting intelligence built directly from a rent roll —
 * INDEPENDENT of the C&I EBITDA path (no import of the operating-company
 * earnings engine). Pure + deterministic (appraisal freshness uses a
 * caller-supplied age, no Date.now()). Never writes.
 *
 * Produces: normalized + vacancy-stressed NOI, tenant concentration, lease
 * rollover, income-approach value under a cap-rate shock, LTV/LTC, DSCR, and
 * appraisal/environmental flags.
 */

export type LeaseUnit = {
  tenantId: string;
  tenantName?: string;
  /** Contract annual base rent for the unit. */
  annualBaseRent: number;
  sqft?: number;
  /** Months until this lease expires (null = MTM/unknown). */
  leaseEndMonthsFromNow?: number | null;
  occupied: boolean;
};

export type PropertyOccupancy = "OWNER_OCCUPIED" | "INVESTOR";

export type PropertyInput = {
  occupancyType: PropertyOccupancy;
  rentRoll: LeaseUnit[];
  otherIncome?: number;
  operatingExpenses: number;
  /** Market vacancy for stress (fraction). */
  marketVacancyPct?: number;
  /** Market cap rate for the income approach (fraction, e.g. 0.07). */
  capRate?: number;
  appraisedValue?: number;
  /** Age of the appraisal in months (null = unknown). */
  appraisalAgeMonths?: number | null;
  loanAmount?: number;
  totalProjectCost?: number;
  annualDebtService?: number;
  environmentalFlags?: string[];
};

export type PropertyIntelligence = {
  occupancyType: PropertyOccupancy;
  grossPotentialRent: number;
  occupiedRent: number;
  physicalVacancyPct: number;
  /** Vacancy actually applied under stress = max(physical, market, floor). */
  stressVacancyPct: number;
  effectiveGrossIncome: number;
  stressedEffectiveGrossIncome: number;
  normalizedNoi: number;
  stressedNoi: number;
  /** Largest tenant as a fraction of gross potential rent. */
  tenantConcentrationTop: number;
  /** Herfindahl index of tenant rent shares (0–1). */
  tenantHhi: number;
  /** Fraction of rent expiring within 12 / 24 months. */
  rollover12moPct: number;
  rollover24moPct: number;
  incomeApproachValue: number | null;
  stressedIncomeApproachValue: number | null;
  ltv: number | null;
  stressedLtv: number | null;
  ltc: number | null;
  dscr: number | null;
  stressedDscr: number | null;
  appraisalFresh: boolean | null;
  environmentalConcerns: string[];
  concerns: string[];
};

/** Appraisal older than this (months) is stale for CRE. */
export const CRE_APPRAISAL_STALE_MONTHS = 12;
/** Absolute floor vacancy applied in a stress even if the property is fully leased. */
export const MIN_STRESS_VACANCY = 0.1;
/** Incremental vacancy layered on top of current/market vacancy in a stress. */
export const STRESS_VACANCY_INCREMENT = 0.05;
/** Cap-rate expansion applied in the stressed income-approach value (fraction). */
export const CAP_RATE_STRESS_EXPANSION = 0.01;

const clampPct = (n: number) => Math.max(0, Math.min(1, n));

export function computePropertyIntelligence(input: PropertyInput): PropertyIntelligence {
  const roll = input.rentRoll;
  const concerns: string[] = [];

  const grossPotentialRent = roll.reduce((s, u) => s + u.annualBaseRent, 0);
  const occupiedRent = roll.filter((u) => u.occupied).reduce((s, u) => s + u.annualBaseRent, 0);
  const physicalVacancyPct = grossPotentialRent > 0 ? clampPct(1 - occupiedRent / grossPotentialRent) : 0;

  // Stress models a downside WORSE than today: the greater of current/market
  // vacancy, worsened by an increment, and floored at an absolute economic vacancy.
  const stressVacancyPct = clampPct(
    Math.max(
      Math.max(physicalVacancyPct, input.marketVacancyPct ?? 0) + STRESS_VACANCY_INCREMENT,
      MIN_STRESS_VACANCY,
    ),
  );

  const otherIncome = input.otherIncome ?? 0;
  const effectiveGrossIncome = occupiedRent + otherIncome;
  const stressedEffectiveGrossIncome = grossPotentialRent * (1 - stressVacancyPct) + otherIncome;

  const normalizedNoi = effectiveGrossIncome - input.operatingExpenses;
  const stressedNoi = stressedEffectiveGrossIncome - input.operatingExpenses;

  // Tenant concentration (share of gross potential rent).
  let tenantConcentrationTop = 0;
  let tenantHhi = 0;
  if (grossPotentialRent > 0) {
    const byTenant = new Map<string, number>();
    for (const u of roll) byTenant.set(u.tenantId, (byTenant.get(u.tenantId) ?? 0) + u.annualBaseRent);
    for (const rent of byTenant.values()) {
      const share = rent / grossPotentialRent;
      tenantConcentrationTop = Math.max(tenantConcentrationTop, share);
      tenantHhi += share * share;
    }
  }

  // Lease rollover.
  const rentExpiringWithin = (months: number) =>
    roll
      .filter((u) => u.occupied && u.leaseEndMonthsFromNow != null && u.leaseEndMonthsFromNow <= months)
      .reduce((s, u) => s + u.annualBaseRent, 0);
  const rollover12moPct = occupiedRent > 0 ? rentExpiringWithin(12) / occupiedRent : 0;
  const rollover24moPct = occupiedRent > 0 ? rentExpiringWithin(24) / occupiedRent : 0;

  // Income approach (value = NOI / cap rate), plus cap-rate-shock stress.
  let incomeApproachValue: number | null = null;
  let stressedIncomeApproachValue: number | null = null;
  if (input.capRate && input.capRate > 0) {
    incomeApproachValue = normalizedNoi / input.capRate;
    stressedIncomeApproachValue = stressedNoi / (input.capRate + CAP_RATE_STRESS_EXPANSION);
  } else {
    concerns.push("no_cap_rate_for_income_approach");
  }

  const ltv =
    input.loanAmount != null && input.appraisedValue && input.appraisedValue > 0
      ? input.loanAmount / input.appraisedValue
      : null;
  const stressedLtv =
    input.loanAmount != null && stressedIncomeApproachValue && stressedIncomeApproachValue > 0
      ? input.loanAmount / stressedIncomeApproachValue
      : null;
  const ltc =
    input.loanAmount != null && input.totalProjectCost && input.totalProjectCost > 0
      ? input.loanAmount / input.totalProjectCost
      : null;

  const dscr =
    input.annualDebtService && input.annualDebtService > 0 ? normalizedNoi / input.annualDebtService : null;
  const stressedDscr =
    input.annualDebtService && input.annualDebtService > 0 ? stressedNoi / input.annualDebtService : null;

  const appraisalFresh =
    input.appraisalAgeMonths == null ? null : input.appraisalAgeMonths <= CRE_APPRAISAL_STALE_MONTHS;
  if (appraisalFresh === false) concerns.push("stale_appraisal");
  if (appraisalFresh === null) concerns.push("appraisal_age_unknown");

  const environmentalConcerns = input.environmentalFlags ?? [];
  if (environmentalConcerns.length > 0) concerns.push("environmental_flags_present");

  // Occupancy-type-specific concerns.
  if (input.occupancyType === "OWNER_OCCUPIED" && tenantConcentrationTop >= 0.9) {
    concerns.push("owner_occupied_repayment_depends_on_operating_business");
  }
  if (input.occupancyType === "INVESTOR" && tenantConcentrationTop >= 0.35) {
    concerns.push("tenant_concentration_risk");
  }
  if (rollover12moPct >= 0.25) concerns.push("high_near_term_lease_rollover");
  if (dscr != null && dscr < 1.2) concerns.push("thin_dscr");
  if (stressedDscr != null && stressedDscr < 1.0) concerns.push("stressed_dscr_below_breakeven");

  return {
    occupancyType: input.occupancyType,
    grossPotentialRent,
    occupiedRent,
    physicalVacancyPct,
    stressVacancyPct,
    effectiveGrossIncome,
    stressedEffectiveGrossIncome,
    normalizedNoi,
    stressedNoi,
    tenantConcentrationTop,
    tenantHhi,
    rollover12moPct,
    rollover24moPct,
    incomeApproachValue,
    stressedIncomeApproachValue,
    ltv,
    stressedLtv,
    ltc,
    dscr,
    stressedDscr,
    appraisalFresh,
    environmentalConcerns,
    concerns,
  };
}
