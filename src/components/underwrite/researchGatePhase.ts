/**
 * Pure phase derivation for the research quality gate surface.
 * SPEC-UNDERWRITE-RESEARCH-GATE-END-TO-END-1
 *
 * Extracted from ResearchGateActionPanel so the full state machine can be
 * unit-tested without rendering. No React / DOM / server imports.
 */

import type { ResearchGateSnapshot, ResearchGatePending } from "./researchGateTypes";

export type ResearchGatePhase =
  | "passed" // gate cleared — no research blocker; panel renders nothing
  | "needs_workbench" // workbench must be initialized before research can run
  | "no_mission" // workbench ready, research never run
  | "running" // mission queued/running (or a run is in flight)
  | "failed" // mission failed/cancelled
  | "gate_failed"; // mission complete but quality gate did not pass

export function deriveResearchGatePhase(
  snapshot: ResearchGateSnapshot,
  workspaceReady: boolean,
  pending: ResearchGatePending,
): ResearchGatePhase {
  // F: gate passed — no research blocker.
  if (snapshot.gatePassed) return "passed";

  // While a run is in flight, always show the running state regardless of the
  // last-known mission status (runMission completes synchronously server-side).
  if (pending === "run") return "running";

  // A: workbench is a prerequisite for research.
  if (!workspaceReady) return "needs_workbench";

  const status = snapshot.missionStatus;
  if (status === null || status === undefined) return "no_mission"; // B
  if (status === "queued" || status === "running") return "running"; // C
  if (status === "failed" || status === "cancelled") return "failed"; // D

  // E: status === "complete" but the gate has not passed.
  return "gate_failed";
}

// SPEC-BIE-SAFE-PRIVATE-COMPANY-RESEARCH-HARDENING-1 Phase 7: decision readiness.
export type DecisionReadiness = {
  preliminary: "ready" | "not_ready";
  committee: "ready" | "not_ready";
  preliminaryBasisLabel: string | null;
  committeeBlockers: string[];
  publicWebNote: string | null;
};

/**
 * SPEC-BIE-EVIDENCE-GRAPH-AND-COMMITTEE-BLOCKER-RESOLUTION-1
 * The blocker panel hides once the gate PASSES. Show the non-blocking committee
 * path when preliminary is cleared but committee is still blocked.
 */
export function shouldShowCommitteeReadiness(snapshot: ResearchGateSnapshot): boolean {
  return (
    snapshot.gatePassed &&
    !snapshot.committeeEligible &&
    (snapshot.committeeBlockerResolutions?.length ?? 0) > 0
  );
}

const PRELIMINARY_BASIS_LABELS: Record<string, string> = {
  public_web: "public sources",
  banker_certified_private_company: "banker-certified private-company evidence",
  loan_file_evidence: "loan-file evidence",
};

/**
 * Derive the preliminary-vs-committee decision readiness for the gate UI.
 * Copy rules: never imply the entity is nonexistent or that research failed
 * when the file supports preliminary; surface committee blockers explicitly.
 */
export function deriveDecisionReadiness(s: ResearchGateSnapshot): DecisionReadiness {
  // gate_passed (preliminary or committee) OR preliminaryEligible → preliminary ready.
  const preliminary: "ready" | "not_ready" =
    s.preliminaryEligible || s.gatePassed ? "ready" : "not_ready";
  const committee: "ready" | "not_ready" = s.committeeEligible ? "ready" : "not_ready";
  return {
    preliminary,
    committee,
    preliminaryBasisLabel: s.preliminaryBasis ? PRELIMINARY_BASIS_LABELS[s.preliminaryBasis] ?? null : null,
    committeeBlockers: s.committeeBlockers ?? [],
    publicWebNote: s.publicWebLimited
      ? "Public web footprint is limited — expected for a private borrower."
      : null,
  };
}
