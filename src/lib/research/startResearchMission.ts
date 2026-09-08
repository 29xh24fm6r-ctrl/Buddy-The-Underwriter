import "server-only";

import { start } from "workflow/api";
import { researchMissionWorkflow, type ResearchWorkflowArgs } from "@/workflows/researchMission";

export type ResearchAdmissionResult =
  | { ok: true; accepted: true; workflow_run_id: string }
  | { ok: false; accepted: false; error: string };

/** Admit research to its durable owner. No request handler awaits model work. */
export async function startResearchMission(
  args: ResearchWorkflowArgs,
): Promise<ResearchAdmissionResult> {
  try {
    const run = await start(researchMissionWorkflow, [args]);
    return { ok: true, accepted: true, workflow_run_id: run.runId };
  } catch (error) {
    return {
      ok: false,
      accepted: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
