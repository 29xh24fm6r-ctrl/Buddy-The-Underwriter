import "server-only";

/**
 * SPEC-M8 ARTIFACT-PIPELINE-1 — verifier pass for the EXISTING feasibility-
 * study narrative pipeline (feasibilityNarrative.ts). That generator is
 * untouched — it still makes its own 8 legacy `callGeminiJSON` calls
 * (tracked allowlisted debt, not migrated to the gateway by this spec).
 * This adds the "at most one verifier per artifact" half via the shared
 * helper, across the whole narrative bundle in one call (Invariant #4),
 * using only the deterministic dimension/composite scores — never the
 * narrative text itself — as facts.
 */

import { verifyArtifactAndFlag, type VerifyArtifactAndFlagResult } from "@/lib/ai/artifactVerification";
import type { FeasibilityNarratives, CompositeFeasibilityScore } from "./types";

type SB = { from: (t: string) => any };

const SECTION_LABELS: Record<keyof FeasibilityNarratives, string> = {
  executiveSummary: "Executive Summary",
  marketDemandNarrative: "Market Demand",
  financialViabilityNarrative: "Financial Viability",
  operationalReadinessNarrative: "Operational Readiness",
  locationSuitabilityNarrative: "Location Suitability",
  riskAssessment: "Risk Assessment",
  recommendation: "Recommendation",
  franchiseComparisonNarrative: "Franchise Comparison",
};

/** These are the extractNarrativeResult fallback strings — nothing real to verify. */
function isPlaceholder(text: string | null, key: string): boolean {
  if (!text) return true;
  return text === `${key} not available.` || text === `${key} generation failed.`;
}

function buildDraftText(narratives: FeasibilityNarratives): string {
  return (Object.keys(SECTION_LABELS) as Array<keyof FeasibilityNarratives>)
    .filter((key) => !isPlaceholder(narratives[key], key))
    .map((key) => `${SECTION_LABELS[key]}:\n${narratives[key]}`)
    .join("\n\n");
}

export async function verifyFeasibilityStudy(args: {
  dealId: string;
  bankId: string;
  composite: CompositeFeasibilityScore;
  narratives: FeasibilityNarratives;
  sb: SB;
}): Promise<VerifyArtifactAndFlagResult | null> {
  const { dealId, bankId, composite, narratives, sb } = args;

  const draftText = buildDraftText(narratives);
  if (!draftText) return null;

  const facts = {
    overallScore: composite.overallScore,
    recommendation: composite.recommendation,
    confidenceLevel: composite.confidenceLevel,
    marketDemandScore: composite.marketDemand.score,
    financialViabilityScore: composite.financialViability.score,
    operationalReadinessScore: composite.operationalReadiness.score,
    locationSuitabilityScore: composite.locationSuitability.score,
    criticalFlags: composite.criticalFlags,
    warningFlags: composite.warningFlags,
    dimensionsMissingData: composite.dimensionsMissingData,
  };

  return verifyArtifactAndFlag({
    dealId,
    bankId,
    artifactType: "feasibility",
    sectionKey: "narratives",
    facts,
    draftText,
    npiTagged: true,
    sb,
  });
}
