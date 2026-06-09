import "server-only";

import type { supabaseAdmin } from "@/lib/supabase/admin";
import {
  buildResearchQualityPayload,
  type ResearchQualityPayload,
} from "@/lib/research/quality/buildResearchQualityPayload";
import {
  EMPTY_RESEARCH_GATE_SNAPSHOT,
  type ResearchGateSnapshot,
} from "@/components/underwrite/researchGateTypes";
import {
  buildMemoCommitteeReadinessSection,
  type MemoCommitteeReadinessSection,
} from "./buildMemoCommitteeReadinessSection";

type SupabaseAdminClient = ReturnType<typeof supabaseAdmin>;

/**
 * SPEC-CREDIT-MEMO-CONSUME-COMMITTEE-INTELLIGENCE-1 (PR-B)
 *
 * Map the shared research-quality payload into the panel's ResearchGateSnapshot
 * shape. This is the server-side equivalent of fetchResearchGateSnapshot() —
 * same fields, fed from the in-process builder instead of an HTTP round-trip, so
 * the memo and the panel read identical committee intelligence. Pure.
 */
export function researchGateSnapshotFromQualityPayload(
  payload: ResearchQualityPayload,
): ResearchGateSnapshot {
  const gate = (payload.gate ?? null) as any;
  return {
    ...EMPTY_RESEARCH_GATE_SNAPSHOT,
    gatePassed: gate?.gate_passed === true,
    qualityScore: gate?.quality_score ?? null,
    trustGrade: gate?.trust_grade ?? null,
    preliminaryEligible: gate?.preliminary_eligible === true,
    committeeEligible: gate?.committee_eligible === true,
    preliminaryBasis: gate?.preliminary_basis ?? null,
    committeeBlockers: Array.isArray(gate?.committee_blockers)
      ? gate.committee_blockers.filter((b: unknown): b is string => typeof b === "string")
      : [],
    publicWebLimited: gate?.evidence_quality?.public_web_limited === true,
    committeeBlockerResolutions: payload.committee_blocker_resolutions ?? [],
    committeeRequirementsPlan: payload.committee_requirements_plan ?? null,
    committeeReadinessSection: payload.committee_readiness_section ?? null,
    committeeDecisionEvidence: payload.committee_decision_evidence ?? null,
    researchFactProjection: payload.research_fact_projection ?? null,
    sourceCollectionPlan: payload.committee_source_collection_plan ?? null,
  };
}

/**
 * Load the credit memo's Committee Readiness section using the SAME committee
 * intelligence the Committee Readiness panel renders. Read-only: never mutates
 * tasks/gates, never approves sources. Returns null when there is no committee
 * model on file (no gate / mission) so the memo simply omits the section.
 */
export async function loadMemoCommitteeIntelligence(args: {
  sb: SupabaseAdminClient;
  dealId: string;
}): Promise<MemoCommitteeReadinessSection | null> {
  const { payload, sourceSnapshots } = await buildResearchQualityPayload(args.sb, args.dealId);
  if (!payload.gate) return null;
  const snapshot = researchGateSnapshotFromQualityPayload(payload);
  return buildMemoCommitteeReadinessSection(snapshot, sourceSnapshots);
}
