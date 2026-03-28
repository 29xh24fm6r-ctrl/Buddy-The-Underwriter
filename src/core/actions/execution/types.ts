/**
 * Phase 65E — Canonical Execution Layer Types
 *
 * Execution is a separate layer from derivation.
 * deriveNextActions remains pure; executeCanonicalAction is side-effectful.
 */

import type { BuddyActionCode, BuddyNextAction } from "@/core/actions/types";

export type CanonicalExecutionStatus =
  | "created"
  | "queued"
  | "already_exists"
  | "noop"
  | "failed";

export type CanonicalExecutionTarget =
  | "conditions"
  | "covenants"
  | "reporting"
  | "monitoring"
  | "financial_snapshot"
  | "pricing"
  | "memo"
  | "committee"
  | "closing"
  | "workflow"
  | "unknown";

export type ExecuteCanonicalActionInput = {
  dealId: string;
  bankId: string;
  action: BuddyNextAction;
  executedBy: string;
  actorType: "banker" | "system";
  source: "canonical_action";
};

export type ExecuteCanonicalActionResult = {
  ok: boolean;
  actionCode: BuddyActionCode;
  target: CanonicalExecutionTarget;
  targetRecordId: string | null;
  status: CanonicalExecutionStatus;
  error?: string;
};
