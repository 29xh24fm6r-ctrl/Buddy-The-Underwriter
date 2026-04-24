import type { ScoreInputs } from "../inputs";
import type { ComponentScore, SubFactorScore } from "../types";
import {
  scoreFeasibilityComposite,
  scoreIndustryDefaultTier,
  scoreYearsInBusiness,
} from "../scoringCurves";
import { finalizeComponent } from "./shared";

export function scoreBusinessStrength(inputs: ScoreInputs): ComponentScore {
  // Years-in-business / franchise maturity: for startups we substitute
  // franchise brand maturity when the deal is a franchise acquisition.
  const yearsProxy = inputs.yearsInBusiness != null
    ? inputs.yearsInBusiness
    : inputs.isFranchise && (inputs.franchise?.unitCount ?? 0) >= 50
      ? // Use a maturity proxy only — never fabricate age.
        null
      : inputs.yearsInBusiness;

  // Reuse buildSBARiskProfile output for the industry tier.
  const industryTier = inputs.riskProfile.industryFactor.tier;

  const subFactors: SubFactorScore[] = [
    {
      name: "years_in_business_or_franchise_maturity",
      rawScore: scoreYearsInBusiness(yearsProxy),
      weight: 0.4,
      value: yearsProxy,
      source: "deal_financial_facts.YEARS_IN_BUSINESS",
      narrative: yearsProxy != null
        ? `${yearsProxy} years in business`
        : "Years in business not captured",
    },
    {
      name: "industry_default_tier",
      rawScore: scoreIndustryDefaultTier(industryTier),
      weight: 0.3,
      value: industryTier,
      source: "buddy_sba_risk_profiles.industry_factor (via buildSBARiskProfile)",
      narrative: `Industry default tier: ${industryTier}`,
    },
    {
      name: "feasibility_composite",
      rawScore: scoreFeasibilityComposite(inputs.feasibilityComposite),
      weight: 0.3,
      value: inputs.feasibilityComposite,
      source: "buddy_feasibility_studies.composite_score",
      narrative: inputs.feasibilityComposite != null
        ? `Feasibility composite ${inputs.feasibilityComposite}/100`
        : "Feasibility study not available",
    },
  ];

  const narrative = buildBusinessNarrative(subFactors);

  return finalizeComponent({
    componentName: "business_strength",
    weight: inputs.isFranchise ? 0.2 : 0.22,
    subFactors,
    narrative,
  });
}

function buildBusinessNarrative(subFactors: SubFactorScore[]): string {
  const pieces: string[] = [];
  const yib = subFactors.find((s) => s.name === "years_in_business_or_franchise_maturity");
  if (yib?.rawScore != null) pieces.push(`business age ${yib.rawScore}/5`);
  const ind = subFactors.find((s) => s.name === "industry_default_tier");
  if (ind?.rawScore != null) pieces.push(`industry tier ${ind.value}`);
  const feas = subFactors.find((s) => s.name === "feasibility_composite");
  if (feas?.rawScore != null) pieces.push(`feasibility ${feas.value}/100`);
  return pieces.length > 0
    ? `Business profile: ${pieces.join(", ")}.`
    : "Business inputs largely missing.";
}
