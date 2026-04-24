import type { ScoreInputs } from "../inputs";
import type { ComponentScore, SubFactorScore } from "../types";
import {
  scoreFicoBand,
  scoreIndustryExperience,
  scoreLiquidityRatio,
  scoreManagementDepth,
  scoreNetWorthRatio,
} from "../scoringCurves";
import { finalizeComponent } from "./shared";

export function scoreBorrowerStrength(inputs: ScoreInputs): ComponentScore {
  // Pick the primary applicant = highest FICO, or first row if no FICOs.
  const primary = pickPrimaryApplicant(inputs);

  const fico = primary?.ficoScore ?? null;
  const liquidity = primary?.liquidAssets ?? null;
  const netWorth = primary?.netWorth ?? null;
  const experience = primary?.industryExperienceYears ?? null;

  const subFactors: SubFactorScore[] = [
    {
      name: "fico",
      rawScore: scoreFicoBand(fico),
      weight: 0.4,
      value: fico,
      source: "borrower_applicant_financials.fico_score",
      narrative: fico != null
        ? `Primary applicant FICO ${fico} — ${ficoLabel(fico)}`
        : "Primary applicant FICO not captured",
    },
    {
      name: "liquidity",
      rawScore: scoreLiquidityRatio(liquidity, inputs.equityInjectionAmount),
      weight: 0.2,
      value: liquidity,
      source: "borrower_applicant_financials.liquid_assets",
      narrative: liquidity != null && inputs.equityInjectionAmount != null
        ? `Liquid assets $${Math.round(liquidity).toLocaleString()} vs. required injection $${Math.round(inputs.equityInjectionAmount).toLocaleString()}`
        : "Liquidity or required injection missing",
    },
    {
      name: "net_worth",
      rawScore: scoreNetWorthRatio(netWorth, inputs.loanAmount),
      weight: 0.15,
      value: netWorth,
      source: "borrower_applicant_financials.net_worth",
      narrative: netWorth != null && inputs.loanAmount != null
        ? `Net worth $${Math.round(netWorth).toLocaleString()} against $${Math.round(inputs.loanAmount).toLocaleString()} loan`
        : "Net worth or loan amount missing",
    },
    {
      name: "industry_experience",
      rawScore: scoreIndustryExperience(experience),
      weight: 0.15,
      value: experience,
      source: "borrower_applicant_financials.industry_experience_years",
      narrative: experience != null
        ? `${experience} years of industry experience`
        : "Industry experience not captured",
    },
    {
      name: "management_depth",
      rawScore: scoreManagementDepth(inputs.managementTeamSize),
      weight: 0.1,
      value: inputs.managementTeamSize,
      source: "buddy_sba_assumptions.management_team",
      narrative: inputs.managementTeamSize != null
        ? `Management team of ${inputs.managementTeamSize} captured`
        : "Management team not captured",
    },
  ];

  const narrative = buildBorrowerNarrative(subFactors, primary);

  return finalizeComponent({
    componentName: "borrower_strength",
    weight: inputs.isFranchise ? 0.25 : 0.28,
    subFactors,
    narrative,
  });
}

function pickPrimaryApplicant(inputs: ScoreInputs) {
  if (inputs.applicants.length === 0) return null;
  return [...inputs.applicants].sort(
    (a, b) => (b.ficoScore ?? 0) - (a.ficoScore ?? 0),
  )[0];
}

function ficoLabel(fico: number): string {
  if (fico >= 760) return "excellent";
  if (fico >= 720) return "strong";
  if (fico >= 680) return "acceptable";
  if (fico >= 640) return "marginal";
  return "weak";
}

function buildBorrowerNarrative(
  subFactors: SubFactorScore[],
  primary: ScoreInputs["applicants"][number] | null,
): string {
  if (!primary) {
    return "Borrower strength cannot be assessed — no applicant data available.";
  }
  const pieces: string[] = [];
  const fico = subFactors.find((s) => s.name === "fico");
  if (fico?.rawScore != null && fico.value != null) {
    pieces.push(`FICO ${fico.value} (${fico.rawScore}/5)`);
  }
  const liq = subFactors.find((s) => s.name === "liquidity");
  if (liq?.rawScore != null) pieces.push(`liquidity ${liq.rawScore}/5`);
  const nw = subFactors.find((s) => s.name === "net_worth");
  if (nw?.rawScore != null) pieces.push(`net-worth ${nw.rawScore}/5`);
  const exp = subFactors.find((s) => s.name === "industry_experience");
  if (exp?.rawScore != null) pieces.push(`${exp.value}yr experience`);
  const mgmt = subFactors.find((s) => s.name === "management_depth");
  if (mgmt?.rawScore != null) pieces.push(`management ${mgmt.rawScore}/5`);
  return pieces.length > 0
    ? `Borrower profile: ${pieces.join(", ")}.`
    : "Borrower inputs largely missing.";
}
