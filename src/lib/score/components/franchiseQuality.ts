import type { ScoreInputs } from "../inputs";
import type { ComponentScore, SubFactorScore } from "../types";
import {
  scoreBrandMaturity,
  scoreFddItem19Percentile,
  scoreFranchiseSbaCertification,
  scoreFranchisorSupportBinary,
} from "../scoringCurves";
import { finalizeComponent } from "./shared";

export function scoreFranchiseQuality(inputs: ScoreInputs): ComponentScore {
  if (!inputs.franchise) {
    // Guard — caller should only invoke when isFranchise is true.
    return {
      componentName: "franchise_quality",
      rawScore: 0,
      weight: 0,
      contribution: 0,
      subFactors: [],
      narrative: "Franchise component not applicable (non-franchise deal).",
      missingInputs: [],
      insufficientData: true,
    };
  }

  const f = inputs.franchise;
  const supportFlag =
    f.hasItem19 === true && f.sbaEligible === true && (f.unitCount ?? 0) >= 50
      ? true
      : f.hasItem19 == null && f.sbaEligible == null && f.unitCount == null
        ? null
        : false;

  const subFactors: SubFactorScore[] = [
    {
      name: "franchise_sba_certification",
      rawScore: scoreFranchiseSbaCertification(f.sbaCertificationStatus),
      weight: 0.35,
      value: f.sbaCertificationStatus,
      source: "franchise_brands.sba_certification_status",
      narrative: f.sbaCertificationStatus != null
        ? `SBA certification status: ${f.sbaCertificationStatus}`
        : "SBA certification status unknown",
    },
    {
      name: "fdd_item19_tier",
      rawScore: scoreFddItem19Percentile(f.item19PercentileRank),
      weight: 0.3,
      value: f.item19PercentileRank,
      source: "fdd_item19_facts.percentile_rank",
      narrative: f.item19PercentileRank != null
        ? `FDD Item 19 percentile rank ${f.item19PercentileRank}`
        : "FDD Item 19 data not available",
    },
    {
      name: "brand_maturity",
      rawScore: scoreBrandMaturity(f.unitCount),
      weight: 0.2,
      value: f.unitCount,
      source: "franchise_brands.unit_count",
      narrative: f.unitCount != null
        ? `${f.unitCount} units`
        : "Unit count not captured",
    },
    {
      name: "franchisor_support",
      rawScore: scoreFranchisorSupportBinary(supportFlag),
      weight: 0.15,
      value: supportFlag == null ? null : supportFlag ? "supported" : "not_supported",
      source: "derived: has_item_19 AND sba_eligible AND unit_count >= 50",
      narrative: supportFlag == null
        ? "Franchisor support inputs missing"
        : supportFlag
          ? "Franchisor support indicators present (binary proxy until dedicated scoring)"
          : "Franchisor support indicators incomplete",
    },
  ];

  const narrative = buildFranchiseNarrative(subFactors);

  return finalizeComponent({
    componentName: "franchise_quality",
    weight: 0.1,
    subFactors,
    narrative,
  });
}

function buildFranchiseNarrative(subFactors: SubFactorScore[]): string {
  const pieces: string[] = [];
  const cert = subFactors.find((s) => s.name === "franchise_sba_certification");
  if (cert?.rawScore != null && cert.value) pieces.push(`${cert.value}`);
  const units = subFactors.find((s) => s.name === "brand_maturity");
  if (units?.rawScore != null && typeof units.value === "number") {
    pieces.push(`${units.value} units`);
  }
  const fdd = subFactors.find((s) => s.name === "fdd_item19_tier");
  if (fdd?.rawScore != null && typeof fdd.value === "number") {
    pieces.push(`Item 19 p${Math.round(fdd.value)}`);
  }
  return pieces.length > 0
    ? `Franchise profile: ${pieces.join(", ")}.`
    : "Franchise inputs largely missing.";
}
