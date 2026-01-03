// src/lib/deals/deriveDealMode.ts
import type { DealMode } from "./dealMode";

/**
 * deriveDealMode
 *
 * Canonical convergence state resolver.
 * This value is NEVER stored in the database — it is always derived live.
 *
 * Priority order (highest → lowest):
 * 1) blocked      — hard system / validation blocker
 * 2) processing   — uploads / OCR / pipeline actively running
 * 3) initializing — empty checklist, system converging
 * 4) needs_input  — missing required items, user action required
 * 5) ready        — all conditions satisfied
 *
 * NOTE: this function intentionally accepts a slightly-flexible input shape
 * to stay compatible across UI callers (some pass checklistState directly).
 */
export function deriveDealMode(input: {
  checklist?:
    | {
        state?: "empty" | "ready" | string;
        pendingCount?: number;
      }
    | null;
  // legacy/alternate caller shape (e.g. narrator components)
  checklistState?: "empty" | "ready" | string;
  pendingCount?: number;

  pipeline?:
    | {
        status?: "blocked" | "completed" | string;
      }
    | null;

  uploads?:
    | {
        processing?: number;
      }
    | null;
}): DealMode {
  const checklistState =
    input.checklist?.state ?? input.checklistState ?? "empty";

  const pendingCount =
    input.checklist?.pendingCount ?? input.pendingCount ?? 0;

  const pipelineStatus = input.pipeline?.status ?? "completed";
  const processingUploads = input.uploads?.processing ?? 0;

  // 1) Hard blocker always wins
  if (pipelineStatus === "blocked") return "blocked";

  // 2) System actively working
  if (processingUploads > 0) return "processing";

  // 3) Empty checklist = initializing (system converging)
  if (checklistState === "empty") return "initializing";

  // 4) Missing required items => needs input
  if (pendingCount > 0) return "needs_input";

  // 5) Everything satisfied
  return "ready";
}
