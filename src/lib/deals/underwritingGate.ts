export type UnderwritingGate = {
  allowed: boolean;
  blockers: string[];
};

export function buildUnderwritingGate(args: {
  lifecycleStage?: string | null;
  missingRequiredTitles: string[];
}) {
  const { lifecycleStage, missingRequiredTitles } = args;
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
