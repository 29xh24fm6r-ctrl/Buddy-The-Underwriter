import "server-only";

import { start } from "workflow/api";
import { researchMissionWorkflow, type ResearchWorkflowArgs } from "@/workflows/researchMission";
import { failMissionAdmission, prepareMissionRun } from "@/lib/research/runMission";

export type ResearchAdmissionResult =
  | { ok: true; accepted: true; workflow_run_id: string; mission_id: string }
  | { ok: true; accepted: false; duplicate: true; mission_id: string }
  | { ok: false; accepted: false; error: string };

/**
 * Admit research to its durable owner. No request handler awaits model work.
 *
 * The mission row is resolved here, before the workflow is started, so the
 * caller's 202 already refers to a persisted `buddy_research_missions` row
 * (status=queued). The underwrite page reads that table; without this the
 * row only appeared once the workflow step ran, and the panel stayed empty
 * until the banker refreshed.
 */
export async function startResearchMission(
  args: ResearchWorkflowArgs,
): Promise<ResearchAdmissionResult> {
  const prepared = await prepareMissionRun(args.dealId, args.missionType, args.subject, {
    depth: args.depth,
    bankId: args.bankId,
    userId: args.userId,
    forceRerun: args.forceRerun,
  });
  if (!prepared.ok) {
    return { ok: false, accepted: false, error: prepared.error };
  }
  if (prepared.duplicate) {
    return { ok: true, accepted: false, duplicate: true, mission_id: prepared.missionId };
  }

  try {
    const run = await start(researchMissionWorkflow, [{ ...args, missionId: prepared.missionId }]);
    return { ok: true, accepted: true, workflow_run_id: run.runId, mission_id: prepared.missionId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Never leave a queued row nothing will execute.
    await failMissionAdmission(prepared.missionId, `workflow_start_failed: ${message}`).catch(() => {});
    return { ok: false, accepted: false, error: message };
  }
}
