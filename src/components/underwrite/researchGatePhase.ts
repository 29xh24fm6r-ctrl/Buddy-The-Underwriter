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
