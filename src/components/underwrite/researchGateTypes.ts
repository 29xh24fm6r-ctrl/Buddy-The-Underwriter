/**
 * Shared types for the research quality gate surface on the underwrite route.
 * SPEC-UNDERWRITE-RESEARCH-GATE-END-TO-END-1
 */

import type { MissionStatus } from "@/lib/research/types";
import type { CommitteeBlockerResolution } from "@/lib/research/committeeBlockerResolution";
import type { CommitteeEvidenceTask } from "@/lib/research/committeeEvidenceTasks";
import type { CommitteeReviewAction } from "@/lib/research/committeeTaskReview";

export type { CommitteeBlockerResolution, CommitteeEvidenceTask, CommitteeReviewAction };

// SPEC-BIE-COMMITTEE-EVIDENCE-REVIEW-ACTIONS-1: handler the workbench passes down
// to apply a review action to a committee evidence task.
export type ReviewTaskHandler = (
  taskId: string,
  action: CommitteeReviewAction,
  opts?: { note?: string; reason?: string },
) => void | Promise<void>;

export type ResearchGatePending = "init" | "run" | null;

// SPEC-RESEARCH-GATE-PRIVATE-BORROWER-AND-EVIDENCE-PACK-1: grouped action cards.
export interface ResearchGateGroupItem {
  label: string;
  meaning: string;
  status: "missing" | "present" | "advisory";
  actionApi: string | null;
  blocksPreliminary: boolean;
  blocksCommittee: boolean;
}
export interface ResearchGateGroups {
  requiredIdentityInputs: ResearchGateGroupItem[];
  researchQualityIssues: ResearchGateGroupItem[];
  bankerCertifiedEvidence: ResearchGateGroupItem[];
}

export interface ResearchGateSnapshot {
  /** True only when the latest quality gate row has gate_passed === true. */
  gatePassed: boolean;
  /** Latest research mission status, or null when no mission exists. */
  missionStatus: MissionStatus | null;
  /** Quality score from the latest gate evaluation, if available. */
  qualityScore: number | null;
  /** Trust grade from the latest gate/mission, if available. */
  trustGrade: string | null;
  /** Human-readable gate failure reasons, when the gate ran but did not pass. */
  gateFailures: string[];
  /** Grouped action cards from the flight deck (null when unavailable → fall back to gateFailures). */
  groups: ResearchGateGroups | null;
  /** Deterministic entity disposition certification level, when available. */
  certificationLevel: string | null;
  // SPEC-BIE-SAFE-PRIVATE-COMPANY-RESEARCH-HARDENING-1 Phase 6/7: readiness split.
  /** Preliminary underwriting is supported by certified/file evidence. */
  preliminaryEligible: boolean;
  /** Committee-grade readiness (public/attested verification + coverage). */
  committeeEligible: boolean;
  /** What preliminary readiness rests on, when eligible. */
  preliminaryBasis:
    | "public_web"
    | "banker_certified_private_company"
    | "loan_file_evidence"
    | null;
  /** Explicit blockers preventing committee-grade readiness. */
  committeeBlockers: string[];
  /** Public web footprint is limited (expected for a private borrower). */
  publicWebLimited: boolean;
  // SPEC-BIE-EVIDENCE-GRAPH-AND-COMMITTEE-BLOCKER-RESOLUTION-1
  /** Evidence-linked, actionable resolution items per committee blocker. */
  committeeBlockerResolutions: CommitteeBlockerResolution[];
}

export const EMPTY_RESEARCH_GATE_SNAPSHOT: ResearchGateSnapshot = {
  gatePassed: false,
  missionStatus: null,
  qualityScore: null,
  trustGrade: null,
  gateFailures: [],
  groups: null,
  certificationLevel: null,
  preliminaryEligible: false,
  committeeEligible: false,
  preliminaryBasis: null,
  committeeBlockers: [],
  publicWebLimited: false,
  committeeBlockerResolutions: [],
};
