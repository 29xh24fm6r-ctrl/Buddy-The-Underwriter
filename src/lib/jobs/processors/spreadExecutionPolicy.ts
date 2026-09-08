import type { SpreadType } from "@/lib/financialSpreads/types";

export type SpreadInputDecision = "ready" | "heartbeat_only" | "missing";

export function decideSpreadInput(args: {
  visibleFactCount: number;
  heartbeatExists: boolean;
}): SpreadInputDecision {
  if (args.visibleFactCount > 0) return "ready";
  return args.heartbeatExists ? "heartbeat_only" : "missing";
}

export function planSpreadRenderPhases(readyTypes: SpreadType[]): {
  initial: SpreadType[];
  finalGlobalCashFlow: boolean;
} {
  return {
    initial: readyTypes.filter((type) => type !== "GLOBAL_CASH_FLOW"),
    finalGlobalCashFlow: readyTypes.includes("GLOBAL_CASH_FLOW"),
  };
}

export function completeRecomputeSpreadTypes(
  requested: SpreadType[],
): SpreadType[] {
  return Array.from(new Set<SpreadType>([...requested, "CLASSIC_PDF"]));
}
