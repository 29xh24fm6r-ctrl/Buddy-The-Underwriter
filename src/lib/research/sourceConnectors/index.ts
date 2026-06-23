/**
 * SPEC-BIE-OFFICIAL-SOURCE-CONNECTOR-FRAMEWORK-1 — barrel + candidate aggregator.
 *
 * Pure module. `buildSourceCandidatePlan` assembles the official/free source
 * candidates for a deal (registry/SOS, government data, adverse screen,
 * competitor) so the quality payload can show, per committee task, the
 * Buddy-native collection path BEFORE the gate fails. Aggregation only — never
 * fetches, never persists, never auto-accepts.
 */

export * from "./types";
export * from "./policy";
export { runManualUrlConnector, sourceDomainOf } from "./manualUrlConnector";
export { planRegistrySources, registryTaskGuidance, validateRegistryEvidence } from "./registryAdapter";
export { buildAdverseScreenPlan, validateAdverseDisposition } from "./adverseScreenAdapter";
export { planGovernmentSources } from "./governmentSourcePlanner";
export { planCompetitorSources } from "./competitorSourceAdapter";

import type { EvidenceRowInput } from "../committeeBlockerResolution";
import { buildAdverseScreenPlan } from "./adverseScreenAdapter";
import { planCompetitorSources } from "./competitorSourceAdapter";
import { planGovernmentSources, type GovernmentSourcePlanInput } from "./governmentSourcePlanner";
import { planRegistrySources, registryTaskGuidance } from "./registryAdapter";
import type { AdverseScreenPlan, SourceCandidate } from "./types";

export type SourceCandidatePlan = {
  registry_candidates: SourceCandidate[];
  government_candidates: SourceCandidate[];
  competitor_candidates: SourceCandidate[];
  adverse_screen_plan: AdverseScreenPlan;
  registry_task_guidance: string;
};

export type BuildSourceCandidatePlanInput = GovernmentSourcePlanInput & {
  legalName?: string | null;
  dba?: string | null;
  principals?: Array<{ person_name?: string | null } | string>;
  competitiveRows?: EvidenceRowInput[];
};

export function buildSourceCandidatePlan(input: BuildSourceCandidatePlanInput): SourceCandidatePlan {
  return {
    registry_candidates: planRegistrySources({ hqState: input.hqState, legalName: input.legalName }),
    government_candidates: planGovernmentSources(input),
    competitor_candidates: planCompetitorSources(input.competitiveRows ?? []),
    adverse_screen_plan: buildAdverseScreenPlan({
      legalName: input.legalName,
      dba: input.dba,
      principals: input.principals,
      includeSanctions: false,
    }),
    registry_task_guidance: registryTaskGuidance(input.hqState),
  };
}
