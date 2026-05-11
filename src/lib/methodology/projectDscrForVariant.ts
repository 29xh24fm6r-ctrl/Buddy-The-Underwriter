/**
 * SPEC-B4.1.3 — Projection: compute DSCR for a hypothetical methodology slate.
 *
 * Pure function — no DB, no server imports. Used by the /methodology/preview
 * endpoint to show the banker the impact of each variant before they commit.
 *
 * Mirrors runCashFlowAggregator's Axis 1 dispatch and the slate-aware
 * ebitdaEngine / officerCompEngine from B4.1.1.
 */

import type { MethodologySlate, MethodologyAxisId, MethodologyVariantId } from "@/lib/methodology/types";
import { computeEbitda } from "@/lib/financialIntelligence/ebitdaEngine";
import { analyzeOfficerComp } from "@/lib/financialIntelligence/officerCompEngine";

export type ProjectionInput = {
  facts: Record<string, number | null>;
  formType: string;
  currentSlate: MethodologySlate;
  override: { axis: MethodologyAxisId; variant: MethodologyVariantId } | null;
  proposedAds: number;
};

export type ProjectionResult = {
  effectiveSlate: MethodologySlate;
  projectedEbitda: number | null;
  projectedOfficerCompAddback: number;
  projectedNcads: number | null;
  projectedDscr: number | null;
  components: string;
};

export function projectDscrForVariant(input: ProjectionInput): ProjectionResult {
  const { facts, formType, currentSlate, override, proposedAds } = input;

  const effectiveSlate: MethodologySlate = override
    ? { ...currentSlate, [override.axis]: override.variant }
    : { ...currentSlate };

  const ebitdaAnalysis = computeEbitda(facts, formType, effectiveSlate);
  const projectedEbitda = ebitdaAnalysis.adjustedEbitda;

  const officerCompAnalysis = analyzeOfficerComp(facts, formType, effectiveSlate);
  const projectedOfficerCompAddback = officerCompAnalysis.adjustedEbitdaImpact ?? 0;

  const ncadsVariant = effectiveSlate.ncads_source;
  let projectedNcads: number | null = null;

  if (ncadsVariant === "conservative") {
    projectedNcads = facts.NET_INCOME ?? null;
  } else if (ncadsVariant === "tax_return_basis") {
    projectedNcads = facts.ORDINARY_BUSINESS_INCOME ?? null;
  } else {
    // "standard" — EBITDA (+ officer-comp addback) → OBI → NI fallback
    if (projectedEbitda !== null) {
      projectedNcads = projectedEbitda + projectedOfficerCompAddback;
    } else if (facts.ORDINARY_BUSINESS_INCOME !== null) {
      projectedNcads = facts.ORDINARY_BUSINESS_INCOME;
    } else if (facts.NET_INCOME !== null) {
      projectedNcads = facts.NET_INCOME;
    }
  }

  const projectedDscr =
    projectedNcads !== null && Number.isFinite(projectedNcads) && proposedAds > 0
      ? Math.round((projectedNcads / proposedAds) * 100) / 100
      : null;

  const components = [
    `EBITDA=${projectedEbitda ?? "null"}`,
    `OfficerCompAddback=${projectedOfficerCompAddback}`,
    `NCADS=${projectedNcads ?? "null"} (via ${ncadsVariant})`,
    `ADS=${proposedAds}`,
    `DSCR=${projectedDscr ?? "null"}`,
  ].join(" | ");

  return {
    effectiveSlate,
    projectedEbitda,
    projectedOfficerCompAddback,
    projectedNcads,
    projectedDscr,
    components,
  };
}
