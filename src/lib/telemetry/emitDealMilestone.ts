/**
 * Deal milestone telemetry adapter.
 * Fans out to the correct ledger(s) without callers needing to know the split.
 *
 * Authority:
 *   deal_pipeline_ledger    → deal-scoped timeline / cockpit UX
 *   buddy_ledger_events     → canonical immutable global observability
 *
 * Always writes to pipeline ledger.
 * Optionally mirrors to observability ledger for high-value milestones.
 * Never throws.
 */
import "server-only";

import { emitPipelineLedgerEvent } from "@/lib/pipeline/emitPipelineLedgerEvent";

// Dynamic import to avoid hard dependency on observability module
async function tryEmitObservability(params: {
  event_type: string;
  event_category: string;
  severity: string;
  deal_id?: string;
  bank_id?: string;
  actor_user_id?: string;
  payload?: Record<string, unknown>;
}): Promise<void> {
  try {
    const { emitBuddyEvent } = await import("@/lib/observability/emitEvent");
    await emitBuddyEvent({
      event_type: params.event_type,
      event_category: params.event_category as any,
      severity: params.severity as any,
      deal_id: params.deal_id,
      bank_id: params.bank_id,
      actor_user_id: params.actor_user_id,
      payload: params.payload,
    });
  } catch {
    // Observability mirror failure is non-fatal
  }
}

export type DealMilestone = {
  eventKey: string;
  dealId: string;
  bankId: string;
  actorId?: string | null;
  stage?: string;
  status: "ok" | "warn" | "error";
  payload?: Record<string, unknown>;
  durationMs?: number;
  /** If true, also write to buddy_ledger_events for global observability */
  mirrorToObservability?: boolean;
};

/** Required milestone events that always dual-write */
const ALWAYS_MIRROR_EVENTS = new Set([
  "deal.created",
  "document.confirmed",
  "recompute.document_state",
  "lifecycle.stage_changed",
  "credit_memo.generated",
  "model_v2.snapshot_persisted",
  "model_v2.parity_checked",
  "model_v2.shadow_diff_logged",
]);

/**
 * Emit a deal milestone event.
 * Always writes to deal_pipeline_ledger.
 * Mirrors to buddy_ledger_events for high-value milestones.
 * Never throws.
 */
export async function emitDealMilestone(milestone: DealMilestone): Promise<void> {
  // Always write to pipeline ledger
  await emitPipelineLedgerEvent({
    eventKey: milestone.eventKey,
    dealId: milestone.dealId,
    bankId: milestone.bankId,
    actorId: milestone.actorId,
    stage: milestone.stage,
    status: milestone.status,
    payload: milestone.payload,
    durationMs: milestone.durationMs,
  });

  // Mirror to observability for required milestones or explicit opt-in
  const shouldMirror =
    milestone.mirrorToObservability === true ||
    ALWAYS_MIRROR_EVENTS.has(milestone.eventKey);

  if (shouldMirror) {
    await tryEmitObservability({
      event_type: milestone.eventKey,
      event_category: "flow",
      severity: milestone.status === "error" ? "error" : milestone.status === "warn" ? "warning" : "info",
      deal_id: milestone.dealId,
      bank_id: milestone.bankId,
      actor_user_id: milestone.actorId ?? undefined,
      payload: {
        ...milestone.payload,
        duration_ms: milestone.durationMs ?? null,
      },
    });
  }
}
