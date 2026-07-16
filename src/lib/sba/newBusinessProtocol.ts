/**
 * SBA New Business Underwriting Protocol — Phase 58A
 *
 * Detects businesses under 2 years old and applies SBA SOP 50 10 8 rules:
 * projected DSCR threshold vs. historical, equity injection floor, business
 * plan required.
 *
 * The actual threshold VALUES (DSCR floor, equity injection floor) are no
 * longer hardcoded here — they resolve from finengine's policy registry
 * (`@/lib/finengine/policyRegistry`), Buddy's single source of truth for
 * every credit-policy axis (SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 / directive
 * 2026-07-14: "Buddy should have only one source of truth for financial
 * calculations"). This module's own job is the SBA-domain logic finengine
 * doesn't own: detecting new-business status from operating-history facts,
 * and the business-plan/management-experience blockers that follow from it.
 *
 * Pure functions. No DB. No LLM.
 */

import { resolvePolicy } from "@/lib/finengine/policyRegistry";
import { detectSBAProgram } from "./sbaGuarantee";
import type { PolicyContext } from "@/lib/finengine/contracts";

export interface NewBusinessRiskFlags {
  isNewBusiness: boolean;
  yearsInBusiness: number | null;
  requiresProjectedDscr: boolean;
  projectedDscrThreshold: number; // resolved from finengine's dscr_floor axis
  requiresManagementExperience: boolean;
  equityInjectionFloor: number; // resolved from finengine's equity_injection_min axis
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

// SBA 7(a) small-loan threshold — same $350k convention dealDataBuilder.ts's
// is_7a_small_loan already uses, reused here (not re-derived) so both stay
// aligned on which loans count as "small" for policy-resolution purposes.
const SBA_7A_SMALL_LOAN_MAX = 350_000;

/** Maps this deal's SBA program + loan size onto a finengine policy productId. */
function resolveProductId(
  dealType: string | null,
  loanAmount: number | null,
): string | undefined {
  const program = detectSBAProgram(dealType);
  if (program === "sba_504") return "SBA_504";
  if (program === "sba_7a_standard" || program === "sba_7a_express") {
    return loanAmount != null && loanAmount <= SBA_7A_SMALL_LOAN_MAX
      ? "SBA_7A_SMALL"
      : "SBA_7A_STANDARD";
  }
  return undefined; // unknown program — registry falls back to its flat definition
}

export function assessNewBusinessRisk(params: {
  yearsInBusiness: number | null;
  monthsInBusiness: number | null;
  hasBusinessPlan: boolean;
  managementYearsInIndustry: number | null;
  /** Deal's SBA program string (e.g. deals.deal_type, "SBA"/"CONVENTIONAL"/"sba_504"/...). */
  loanType: string;
  /** Loan amount, if known — refines productId to SBA_7A_SMALL vs STANDARD. */
  loanAmount?: number | null;
}): NewBusinessUnderwritingResult {
  const months =
    params.monthsInBusiness ??
    (params.yearsInBusiness !== null ? params.yearsInBusiness * 12 : null);

  const isNewBusiness = months !== null && months < 24;
  const blockers: string[] = [];
  const warnings: string[] = [];

  const productId = resolveProductId(params.loanType, params.loanAmount ?? null);
  const policyCtx: PolicyContext = { productId, isNewBusiness };
  const dscrPolicy = resolvePolicy("dscr_floor", policyCtx);
  const equityPolicy = resolvePolicy("equity_injection_min", policyCtx);
  // Registry axes are seeded with real values (see policyRegistry.ts AXES) —
  // null only if a future axis definition regresses to no floor/overlay at
  // all, which would be a registry bug, not a valid "no requirement" state.
  const projectedDscrThreshold = dscrPolicy.effective ?? 1.1;
  const equityInjectionFloor = equityPolicy.effective ?? 0.1;

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
      `Projected DSCR threshold: ${projectedDscrThreshold}x. ` +
      `Minimum equity injection: ${(equityInjectionFloor * 100).toFixed(0)}% of total project cost.`
    : `This is an ${riskFactorLabel.toLowerCase().replace("_", " ")} business ` +
      `(${months !== null ? Math.round(months / 12) : "unknown"} years operating history). ` +
      `Historical DSCR analysis applies with a ${projectedDscrThreshold}x minimum threshold.`;

  return {
    flags: {
      isNewBusiness,
      yearsInBusiness: params.yearsInBusiness,
      requiresProjectedDscr: isNewBusiness,
      projectedDscrThreshold,
      requiresManagementExperience: isNewBusiness,
      equityInjectionFloor,
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
