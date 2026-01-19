export type UnderwritingGate = {
  allowed: boolean;
  blockers: string[];
};

export function buildUnderwritingGate(args: {
  lifecycleStage?: string | null;
  missingRequiredTitles: string[];
  intakeInitialized?: boolean;
}) {
  const { lifecycleStage, missingRequiredTitles, intakeInitialized } = args;
  if (!intakeInitialized) {
    return {
      allowed: false,
      blockers: ["Intake initializing…"],
    } as UnderwritingGate;
  }
  if (lifecycleStage !== "collecting" && lifecycleStage !== "ready") {
    return {
      allowed: false,
      blockers: ["Deal intake is not ready for underwriting yet."],
    } as UnderwritingGate;
  }

  if (missingRequiredTitles.length > 0) {
    return {
      allowed: false,
      blockers: missingRequiredTitles,
    } as UnderwritingGate;
  }

  return { allowed: true, blockers: [] } as UnderwritingGate;
}
