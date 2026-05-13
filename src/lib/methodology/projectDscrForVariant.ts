/**
 * SPEC-B4.1.3 — Projection: compute DSCR for a hypothetical methodology slate.
 * SPEC-B4.1.4 — Officer-comp fold-in is conditional on the methodology
 *               contract, matching computeBusinessEbitdaFacts:v2 exactly.
 *
 * Pure function — no DB, no server imports. Used by the /methodology/preview
 * endpoint to show the banker the impact of each variant before they commit.
 *
 * Mirrors the canonical chain's EBITDA computation:
 *   - Axis 2 (ebitda_addback_stack) dispatch lives in computeEbitda.
 *   - Axis 3 (officer_comp) dispatch lives in analyzeOfficerComp.
 *   - Officer-comp fold-in into NCADS is delegated to applyOfficerCompFoldIn,
 *     the same helper the canonical writer uses. Both surfaces are now
 *     locked to the methodology contract via a single implementation.
 */

import type { MethodologySlate, MethodologyAxisId, MethodologyVariantId } from "@/lib/methodology/types";
import { computeEbitda } from "@/lib/financialIntelligence/ebitdaEngine";
import { analyzeOfficerComp } from "@/lib/financialIntelligence/officerCompEngine";
import { applyOfficerCompFoldIn } from "@/lib/methodology/applyOfficerCompFoldIn";

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

  // SPEC-B4.1.4 — officer-comp fold-in policy delegated to applyOfficerCompFoldIn
  // so this projection cannot drift from computeBusinessEbitdaFacts:v2's writer.
  const foldInDecision = applyOfficerCompFoldIn({
    slate: effectiveSlate,
    officerCompAdjustedEbitdaImpact:
      projectedOfficerCompAddback > 0 ? projectedOfficerCompAddback : null,
  });

  const ncadsVariant = effectiveSlate.ncads_source;
  let projectedNcads: number | null = null;

  if (ncadsVariant === "conservative") {
    projectedNcads = facts.NET_INCOME ?? null;
  } else if (ncadsVariant === "tax_return_basis") {
    projectedNcads = facts.ORDINARY_BUSINESS_INCOME ?? null;
  } else {
    // "standard" NCADS — EBITDA → OBI → NI fallback.
    // Officer-comp folds into the EBITDA path only when the helper says so.
    if (projectedEbitda !== null) {
      projectedNcads = projectedEbitda + foldInDecision.foldInAmount;
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

  // Label the addback's role in the components string only when NCADS path
  // actually exercised the fold-in decision (i.e. ncads_source = "standard").
  const officerCompLabel =
    ncadsVariant === "standard"
      ? foldInDecision.shouldFold
        ? " (folded)"
        : " (observational)"
      : "";

  const components = [
    `EBITDA=${projectedEbitda ?? "null"}`,
    `OfficerCompAddback=${projectedOfficerCompAddback}${officerCompLabel}`,
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
