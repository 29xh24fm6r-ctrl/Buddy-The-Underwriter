// src/lib/sba/sbaAssumptionCoach.ts
// Phase BPG — Real-time assumption coaching tips for the interview UI.
// Pure function. Fires lightweight, non-blocking advisory tips as the
// borrower types — distinct from the NAICS benchmark validator which runs
// server-side at package build time.

import type { SBAAssumptions } from "./sbaReadinessTypes";

export type CoachingSeverity = "info" | "warning" | "concern";

export interface CoachingTip {
  field: string;
  severity: CoachingSeverity;
  title: string;
  message: string;
}

export interface CoachingInput {
  assumptions: Partial<SBAAssumptions>;
  currentPrimeRate?: number; // decimal; banker-provided context
  isNewBusiness?: boolean;
}

export function getAssumptionCoachingTips(
  input: CoachingInput,
): CoachingTip[] {
  const { assumptions, currentPrimeRate = 0.085, isNewBusiness = false } = input;
  const tips: CoachingTip[] = [];

  // Growth rate sanity per stream
  for (const stream of assumptions.revenueStreams ?? []) {
    if (stream.growthRateYear1 > 0.3) {
      tips.push({
        field: `revenueStreams[${stream.id}].growthRateYear1`,
        severity: "warning",
        title: "Aggressive year-1 growth",
        message: `${stream.name || "This stream"} year-1 growth of ${(stream.growthRateYear1 * 100).toFixed(0)}% is aggressive. Bankers will ask how you'll achieve this — pipeline, new channels, or expansion?`,
      });
    }
    if (stream.growthRateYear1 < 0) {
      tips.push({
        field: `revenueStreams[${stream.id}].growthRateYear1`,
        severity: "info",
        title: "Revenue decline projected",
        message: `${stream.name || "This stream"} shows declining revenue in year 1. Make sure the plan explains why (seasonality, wind-down, pivot).`,
      });
    }
  }

  // COGS >85% = concern (too thin)
  const cogsY1 = assumptions.costAssumptions?.cogsPercentYear1;
  if (cogsY1 !== undefined && cogsY1 > 0.85) {
    tips.push({
      field: "costAssumptions.cogsPercentYear1",
      severity: "concern",
      title: "Very thin gross margin",
      message: `COGS at ${(cogsY1 * 100).toFixed(0)}% leaves less than 15% gross margin for operating expenses and debt service. Re-examine pricing or input costs.`,
    });
  }

  // Equity injection
  const loan = assumptions.loanImpact as (SBAAssumptions["loanImpact"] & {
    equityInjectionAmount?: number;
  }) | undefined;
  const equity = loan?.equityInjectionAmount ?? 0;
  const loanAmt = loan?.loanAmount ?? 0;
  if (loanAmt > 0 && equity >= 0) {
    const totalProject = loanAmt + equity; // minimal — other sources not yet visible here
    const equityPct = totalProject > 0 ? equity / totalProject : 0;
    if (equityPct < 0.1) {
      tips.push({
        field: "loanImpact.equityInjectionAmount",
        severity: "concern",
        title: "Equity injection below 10%",
        message: `Equity injection of ${(equityPct * 100).toFixed(1)}% is below SBA's 10% existing-business minimum. Startups require 20%.`,
      });
    } else if (isNewBusiness && equityPct < 0.2) {
      tips.push({
        field: "loanImpact.equityInjectionAmount",
        severity: "warning",
        title: "New business equity below 20%",
        message: `SBA requires at least 20% equity injection for new businesses. Current: ${(equityPct * 100).toFixed(1)}%.`,
      });
    }
  }

  // DSO >90 = warning
  const dso = assumptions.workingCapital?.targetDSO;
  if (dso !== undefined && dso > 90) {
    tips.push({
      field: "workingCapital.targetDSO",
      severity: "warning",
      title: "High days sales outstanding",
      message: `DSO of ${dso} days will tie up significant working capital. Consider progress billing or deposits.`,
    });
  }

  // Interest rate vs current prime
  const rate = loan?.interestRate;
  if (rate !== undefined && currentPrimeRate) {
    const spreadBps = Math.round((rate - currentPrimeRate) * 10000);
    if (rate < currentPrimeRate) {
      tips.push({
        field: "loanImpact.interestRate",
        severity: "warning",
        title: "Rate below current prime",
        message: `Assumed rate ${(rate * 100).toFixed(2)}% is below current prime (${(currentPrimeRate * 100).toFixed(2)}%). SBA variable rates typically sit at prime + spread.`,
      });
    } else if (spreadBps > 500) {
      tips.push({
        field: "loanImpact.interestRate",
        severity: "info",
        title: "Spread above SOP typical range",
        message: `Rate ${(rate * 100).toFixed(2)}% is ${(spreadBps / 100).toFixed(2)}% over current prime. SOP 50 10 caps 7(a) spreads — banker will confirm final pricing.`,
      });
    }
  }

  // Management experience
  for (const mbr of assumptions.managementTeam ?? []) {
    if (isNewBusiness && mbr.yearsInIndustry < 3) {
      tips.push({
        field: `managementTeam[${mbr.name}].yearsInIndustry`,
        severity: "warning",
        title: "Limited industry experience",
        message: `${mbr.name || "Management member"} has ${mbr.yearsInIndustry} years in industry. For new businesses, SBA looks carefully at relevant experience — plan should emphasize transferable skills or advisors.`,
      });
    }
  }

  return tips;
}
