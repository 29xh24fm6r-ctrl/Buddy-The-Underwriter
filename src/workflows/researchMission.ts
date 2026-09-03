import type { MissionDepth, MissionSubject, MissionType } from "@/lib/research/types";

export type ResearchWorkflowArgs = {
  dealId: string;
  missionType: MissionType;
  subject: MissionSubject;
  depth: MissionDepth;
  bankId: string | null;
  userId: string | null;
  forceRerun?: boolean;
};

/**
 * Durable owner for research. The workflow returns immediately to the HTTP
 * caller, while this retryable step resumes from runMission's persisted
 * checkpoints after process restarts or transient failures.
 */
export async function researchMissionWorkflow(args: ResearchWorkflowArgs) {
  "use workflow";
  return executeResearchMission(args);
}

export async function executeResearchMission(args: ResearchWorkflowArgs) {
  "use step";
  const { runMission } = await import("@/lib/research/runMission");
  const result = await runMission(args.dealId, args.missionType, args.subject, {
    depth: args.depth,
    bankId: args.bankId,
    userId: args.userId,
    forceRerun: args.forceRerun,
  });

  if (!result.ok) {
    throw new Error(result.error ?? "research_mission_failed");
  }

  return result;
}
