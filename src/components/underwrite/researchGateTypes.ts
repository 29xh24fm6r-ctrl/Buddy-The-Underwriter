/**
 * Shared types for the research quality gate surface on the underwrite route.
 * SPEC-UNDERWRITE-RESEARCH-GATE-END-TO-END-1
 */

import type { MissionStatus } from "@/lib/research/types";

export type ResearchGatePending = "init" | "run" | null;

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
}

export const EMPTY_RESEARCH_GATE_SNAPSHOT: ResearchGateSnapshot = {
  gatePassed: false,
  missionStatus: null,
  qualityScore: null,
  trustGrade: null,
  gateFailures: [],
};
