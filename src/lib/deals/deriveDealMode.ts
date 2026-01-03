import type { DealMode } from "./dealMode";

export function deriveDealMode(args: {
  checklistState: "empty" | "ready";
  pendingCount: number;
  uploadsProcessingCount?: number;
  pipelineStatus?: "blocked" | "completed" | "running" | "idle";
}): DealMode {
  const processing = (args.uploadsProcessingCount ?? 0) > 0;
  const blocked = args.pipelineStatus === "blocked";

  if (blocked) return "blocked";
  if (processing) return "processing";
  if (args.checklistState === "empty") return "initializing";
  if (args.pendingCount > 0) return "needs_input";
  return "ready";
}
