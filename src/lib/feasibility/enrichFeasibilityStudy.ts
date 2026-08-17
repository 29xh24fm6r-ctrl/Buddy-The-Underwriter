import "server-only";

/**
 * SPEC-M8 ARTIFACT-PIPELINE-1 — post-hoc enrichment of an already-persisted
 * feasibility study: citation attribution + verifier pass. Called AFTER
 * feasibilityEngine.ts's generateFeasibilityStudy has already inserted the
 * buddy_feasibility_studies row — this only ever UPDATEs that same row,
 * feasibilityEngine.ts itself is untouched. Best-effort by design: the
 * caller (the generate route) must treat a failure here as non-fatal,
 * since the study itself already generated successfully.
 */

import { loadDealGroundingSegments, attributeFeasibilityCitations, flagUncitedFeasibilityFields } from "./feasibilityCitations";
import { finishInstitutionalArtifact } from "@/lib/ai/frontierArtifactFactory";
import { persistArtifactFlags } from "@/lib/ai/artifactVerification";
import type { CompositeFeasibilityScore, FeasibilityNarratives } from "./types";

type SB = { from: (t: string) => any };

export async function enrichFeasibilityStudy(args: {
  dealId: string;
  bankId: string;
  studyId: string;
  composite: CompositeFeasibilityScore;
  sb: SB;
}): Promise<void> {
  const { dealId, bankId, studyId, composite, sb } = args;

  const { data: studyRow } = await sb
    .from("buddy_feasibility_studies")
    .select("narratives")
    .eq("id", studyId)
    .maybeSingle();

  const narratives = (studyRow?.narratives ?? null) as FeasibilityNarratives | null;
  if (!narratives) return;

  const { segments, allUrls } = await loadDealGroundingSegments(dealId, sb);
  const citations = attributeFeasibilityCitations(narratives, segments, allUrls);
  await flagUncitedFeasibilityFields({ dealId, bankId, studyId, citations, sb });

  const sections = Object.entries(narratives).flatMap(([key, text]) =>
    typeof text === "string" && text.trim() ? [{ key, text }] : [],
  );
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
  const finished = await finishInstitutionalArtifact({
    artifactType: "feasibility", facts, sections, dealId, npiTagged: true,
  });
  await persistArtifactFlags({
    dealId, bankId, artifactType: "feasibility", sectionKey: "narratives",
    flaggedClaims: finished.flaggedClaims, sb,
  });
  const repairedNarratives = Object.fromEntries(
    finished.sections.map((section) => [section.key, section.text]),
  ) as unknown as FeasibilityNarratives;

  await sb
    .from("buddy_feasibility_studies")
    .update({
      narrative_citations: citations,
      narratives: repairedNarratives,
      verification_verdict: finished.verdict,
      verification_flagged_claims: finished.flaggedClaims,
    })
    .eq("id", studyId);
}
