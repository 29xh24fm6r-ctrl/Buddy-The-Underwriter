/**
 * SPEC-B4.1.4 — Single source of truth for officer-comp fold-in policy.
 *
 * Both computeBusinessEbitdaFacts (canonical writer) and projectDscrForVariant
 * (picker projection) MUST call this helper rather than reimplement the policy.
 * Drift between the two callers is the exact bug class Build Principle #17
 * was written to prevent.
 *
 * Contract source: METHODOLOGY_AXES.ebitda_addback_stack.aggressive:
 *   "Standard stack plus officer compensation normalization for closely-held entities."
 *
 * Therefore fold officer-comp into EBITDA ONLY when ALL of:
 *   - ebitda_addback_stack === "aggressive"
 *   - officer_comp !== "no_normalization"
 *   - officer-comp engine produced a positive adjustedEbitdaImpact
 *
 * Pure function. No DB, no server-only imports, no side effects.
 */

import type { MethodologySlate } from "@/lib/methodology/types";

export interface OfficerCompFoldInDecision {
  readonly shouldFold: boolean;
  readonly foldInAmount: number;
}

export function applyOfficerCompFoldIn(args: {
  slate: MethodologySlate;
  officerCompAdjustedEbitdaImpact: number | null;
}): OfficerCompFoldInDecision {
  const { slate, officerCompAdjustedEbitdaImpact } = args;
  const shouldFold =
    slate.ebitda_addback_stack === "aggressive" &&
    slate.officer_comp !== "no_normalization" &&
    officerCompAdjustedEbitdaImpact !== null &&
    officerCompAdjustedEbitdaImpact > 0;
  return {
    shouldFold,
    foldInAmount: shouldFold ? (officerCompAdjustedEbitdaImpact as number) : 0,
  };
}
