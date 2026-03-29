/**
 * SBA New Business Underwriting Protocol — Phase 58A
 *
 * Detects businesses under 2 years old and applies SBA SOP 50 10 8 rules:
 * projected DSCR threshold 1.25x (not historical 1.10x),
 * equity injection floor 20%, business plan required.
 *
 * Pure functions. No DB. No LLM.
 */

export interface NewBusinessRiskFlags {
  isNewBusiness: boolean;
  yearsInBusiness: number | null;
  requiresProjectedDscr: boolean;
  projectedDscrThreshold: number; // 1.25 new, 1.10 existing
  requiresManagementExperience: boolean;
  equityInjectionFloor: number; // 0.20 new, 0.10 existing
  requiresStartupBusinessPlan: boolean;
  blockers: string[];
  warnings: string[];
  narrativeContext: string;
}

export interface NewBusinessUnderwritingResult {
  flags: NewBusinessRiskFlags;
  riskFactorLabel: "STARTUP" | "EARLY_STAGE" | "ESTABLISHED" | "SEASONED";
  riskMultiplier: number;
  narrativeContext: string;
}

const SBA_7A_DSCR_EXISTING = 1.1;
const SBA_7A_DSCR_NEW_BUSINESS = 1.25; // SOP 50 10 8
const EQUITY_FLOOR_EXISTING = 0.1;
const EQUITY_FLOOR_NEW_BUSINESS = 0.2;

export function assessNewBusinessRisk(params: {
  yearsInBusiness: number | null;
  monthsInBusiness: number | null;
  hasBusinessPlan: boolean;
  managementYearsInIndustry: number | null;
  loanType: string;
}): NewBusinessUnderwritingResult {
  const months =
    params.monthsInBusiness ??
    (params.yearsInBusiness !== null ? params.yearsInBusiness * 12 : null);

  const isNewBusiness = months !== null && months < 24;
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (isNewBusiness) {
    if (!params.hasBusinessPlan) {
      blockers.push(
        "New business (< 2 years) requires a business plan with 3-year projections per SBA SOP 50 10 8",
      );
    }
    if (
      params.managementYearsInIndustry !== null &&
      params.managementYearsInIndustry < 3
    ) {
      warnings.push(
        `Management has ${params.managementYearsInIndustry} year(s) of industry experience — ` +
          "SBA lenders expect demonstrable industry expertise for new business loans",
      );
    }
    if (params.managementYearsInIndustry === null) {
      warnings.push(
        "Management industry experience not documented — required for new business SBA underwriting",
      );
    }
  }

  let riskFactorLabel: NewBusinessUnderwritingResult["riskFactorLabel"];
  let riskMultiplier: number;

  if (months === null) {
    riskFactorLabel = "ESTABLISHED";
    riskMultiplier = 1.0;
  } else if (months < 6) {
    riskFactorLabel = "STARTUP";
    riskMultiplier = 1.8;
  } else if (months < 24) {
    riskFactorLabel = "EARLY_STAGE";
    riskMultiplier = 1.4;
  } else if (months < 60) {
    riskFactorLabel = "ESTABLISHED";
    riskMultiplier = 1.0;
  } else {
    riskFactorLabel = "SEASONED";
    riskMultiplier = 0.9;
  }

  const narrativeContext = isNewBusiness
    ? `This is a ${riskFactorLabel.toLowerCase().replace("_", " ")} business ` +
      `(${months !== null ? Math.round(months) : "unknown"} months operating history). ` +
      `SBA SOP 50 10 8 requires projected DSCR analysis for businesses under 2 years. ` +
      `Projected DSCR threshold: ${SBA_7A_DSCR_NEW_BUSINESS}x. ` +
      `Minimum equity injection: ${(EQUITY_FLOOR_NEW_BUSINESS * 100).toFixed(0)}% of total project cost.`
    : `This is an ${riskFactorLabel.toLowerCase().replace("_", " ")} business ` +
      `(${months !== null ? Math.round(months / 12) : "unknown"} years operating history). ` +
      `Historical DSCR analysis applies with a ${SBA_7A_DSCR_EXISTING}x minimum threshold.`;

  return {
    flags: {
      isNewBusiness,
      yearsInBusiness: params.yearsInBusiness,
      requiresProjectedDscr: isNewBusiness,
      projectedDscrThreshold: isNewBusiness
        ? SBA_7A_DSCR_NEW_BUSINESS
        : SBA_7A_DSCR_EXISTING,
      requiresManagementExperience: isNewBusiness,
      equityInjectionFloor: isNewBusiness
        ? EQUITY_FLOOR_NEW_BUSINESS
        : EQUITY_FLOOR_EXISTING,
      requiresStartupBusinessPlan: isNewBusiness,
      blockers,
      warnings,
      narrativeContext,
    },
    riskFactorLabel,
    riskMultiplier,
    narrativeContext,
  };
}

export function detectNewBusinessFromFacts(
  facts: Array<{
    fact_key: string;
    value_numeric: number | null;
    value_text: string | null;
  }>,
): { yearsInBusiness: number | null; monthsInBusiness: number | null } {
  const yearsFact = facts.find((f) => f.fact_key === "YEARS_IN_BUSINESS");
  const monthsFact = facts.find((f) => f.fact_key === "MONTHS_IN_BUSINESS");
  const dateFact = facts.find(
    (f) =>
      f.fact_key === "BUSINESS_DATE_FORMED" || f.fact_key === "DATE_FORMED",
  );

  let monthsInBusiness: number | null = null;

  if (monthsFact?.value_numeric != null) {
    monthsInBusiness = monthsFact.value_numeric;
  } else if (yearsFact?.value_numeric != null) {
    monthsInBusiness = yearsFact.value_numeric * 12;
  } else if (dateFact?.value_text) {
    const formed = new Date(dateFact.value_text);
    if (!isNaN(formed.getTime())) {
      const now = new Date();
      monthsInBusiness =
        (now.getFullYear() - formed.getFullYear()) * 12 +
        (now.getMonth() - formed.getMonth());
    }
  }

  return {
    yearsInBusiness: monthsInBusiness !== null ? monthsInBusiness / 12 : null,
    monthsInBusiness,
  };
}
