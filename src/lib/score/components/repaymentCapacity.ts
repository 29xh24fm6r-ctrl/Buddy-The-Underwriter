import type { ScoreInputs } from "../inputs";
import type { ComponentScore, SubFactorScore } from "../types";
import {
  scoreBaseDSCR,
  scoreGlobalDSCR,
  scoreLoanTermRiskTier,
  scoreProjectedVsHistoricalVariance,
  scoreStressDSCR,
} from "../scoringCurves";
import { finalizeComponent } from "./shared";

export function scoreRepaymentCapacity(inputs: ScoreInputs): ComponentScore {
  const variance = extractProjectionVariance(inputs);
  const termTier = inputs.riskProfile.loanTermFactor.tier;

  const subFactors: SubFactorScore[] = [
    {
      name: "dscr_base",
      rawScore: scoreBaseDSCR(inputs.dscrBase),
      weight: 0.35,
      value: inputs.dscrBase,
      source: "buddy_sba_packages.dscr_year1_base",
      narrative: inputs.dscrBase != null
        ? `Base DSCR ${inputs.dscrBase.toFixed(2)}`
        : "Base DSCR not available",
    },
    {
      name: "dscr_stress",
      rawScore: scoreStressDSCR(inputs.dscrStress),
      weight: 0.25,
      value: inputs.dscrStress,
      source: "buddy_sba_packages.dscr_year1_downside",
      narrative: inputs.dscrStress != null
        ? `Stress DSCR ${inputs.dscrStress.toFixed(2)}`
        : "Stress DSCR not available",
    },
    {
      name: "projected_vs_historical",
      rawScore: scoreProjectedVsHistoricalVariance(
        variance?.projected ?? null,
        variance?.historical ?? null,
      ),
      weight: 0.15,
      value: variance?.ratio ?? null,
      source: "buddy_sba_packages.projections_annual vs historical facts",
      narrative: variance
        ? `Projection variance ${(variance.ratio * 100).toFixed(0)}%`
        : "Projection variance cannot be computed",
    },
    {
      name: "global_dscr",
      rawScore: scoreGlobalDSCR(inputs.dscrGlobal),
      weight: 0.15,
      value: inputs.dscrGlobal,
      source: "buddy_sba_packages.global_dscr",
      narrative: inputs.dscrGlobal != null
        ? `Global cash-flow DSCR ${inputs.dscrGlobal.toFixed(2)}`
        : "Global cash-flow DSCR not available",
    },
    {
      name: "loan_term_risk_tier",
      rawScore: scoreLoanTermRiskTier(termTier),
      weight: 0.1,
      value: termTier,
      source: "buddy_sba_risk_profiles.loan_term_factor (via buildSBARiskProfile)",
      narrative: `Loan-term risk tier: ${termTier}`,
    },
  ];

  const narrative = buildRepaymentNarrative(subFactors);

  return finalizeComponent({
    componentName: "repayment_capacity",
    weight: inputs.isFranchise ? 0.3 : 0.33,
    subFactors,
    narrative,
  });
}

function extractProjectionVariance(inputs: ScoreInputs): {
  projected: number;
  historical: number;
  ratio: number;
} | null {
  const proj = inputs.projectionsAnnual as any;
  if (!proj || typeof proj !== "object") return null;

  // Expect projections shape like { year1: { revenue: ... } } or an array.
  const firstYearRevenue =
    proj?.year1?.revenue ??
    proj?.[0]?.revenue ??
    (Array.isArray(proj) && proj[0]?.revenue) ??
    null;

  const projected = typeof firstYearRevenue === "number" ? firstYearRevenue : null;
  const historical = inputs.annualRevenueUsd;
  if (projected == null || historical == null || historical === 0) return null;
  return {
    projected,
    historical,
    ratio: Math.abs(projected - historical) / Math.abs(historical),
  };
}

function buildRepaymentNarrative(subFactors: SubFactorScore[]): string {
  const pieces: string[] = [];
  const base = subFactors.find((s) => s.name === "dscr_base");
  if (base?.rawScore != null && typeof base.value === "number") {
    pieces.push(`base DSCR ${base.value.toFixed(2)}`);
  }
  const str = subFactors.find((s) => s.name === "dscr_stress");
  if (str?.rawScore != null && typeof str.value === "number") {
    pieces.push(`stress DSCR ${str.value.toFixed(2)}`);
  }
  const gbl = subFactors.find((s) => s.name === "global_dscr");
  if (gbl?.rawScore != null && typeof gbl.value === "number") {
    pieces.push(`global DSCR ${gbl.value.toFixed(2)}`);
  }
  return pieces.length > 0
    ? `Repayment capacity: ${pieces.join(", ")}.`
    : "Repayment-capacity inputs largely missing.";
}
