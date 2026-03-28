/**
 * Phase 65H — Queue Actionability Derivation
 *
 * Determines what kind of action can be taken from the command center.
 * Pure function — no DB, no side effects.
 */

import type { QueueActionability, QueueReasonCode, BlockingParty } from "./types";
import type { CanonicalExecutionMode } from "@/core/actions/execution/canonicalActionExecutionMap";

export type ActionabilityInput = {
  isActionExecutable: boolean;
  executionMode: CanonicalExecutionMode | null;
  blockingParty: BlockingParty;
  queueReasonCode: QueueReasonCode;
  reviewBacklogCount: number;
};

export function deriveQueueActionability(input: ActionabilityInput): QueueActionability {
  // Borrower is blocking — banker can only wait or resend
  if (input.blockingParty === "borrower") {
    return "waiting_on_borrower";
  }

  // Executable via 65E execution layer (direct_write or queue_job)
  if (
    input.isActionExecutable &&
    (input.executionMode === "direct_write" || input.executionMode === "queue_job")
  ) {
    return "execute_now";
  }

  // Needs human review (uploads, extracted data, classification)
  if (
    input.reviewBacklogCount > 0 ||
    input.queueReasonCode === "uploads_waiting_review"
  ) {
    return "review_required";
  }

  // Has an action but it's task_only — navigate to panel
  if (input.executionMode === "task_only") {
    return "open_panel";
  }

  // Healthy or no immediate work
  if (input.queueReasonCode === "healthy_monitoring") {
    return "monitor_only";
  }

  // Default: navigate to relevant panel
  return "open_panel";
}
