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
import { verifyFeasibilityStudy } from "./verifyFeasibilityStudy";
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

  const verification = await verifyFeasibilityStudy({ dealId, bankId, composite, narratives, sb });

  await sb
    .from("buddy_feasibility_studies")
    .update({
      narrative_citations: citations,
      verification_verdict: verification?.verdict ?? null,
      verification_flagged_claims: verification?.flaggedClaims ?? null,
    })
    .eq("id", studyId);
}
