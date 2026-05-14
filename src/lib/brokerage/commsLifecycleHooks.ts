/**
 * Phase 12A — Lifecycle Event Hooks for Brokerage Comms
 *
 * Bridges deal/document lifecycle events to the comms pipeline.
 * Hooks only enqueue via orchestrator/outbox — no direct adapter calls.
 * Default processOutbox: false.
 */

import { enqueueBorrowerNudges } from "@/lib/brokerage/borrowerNudges";
import { enqueueBankerAlerts, type BankerAlertPurpose } from "@/lib/brokerage/bankerAlerts";

// ── Types ───────────────────────────────────────────────────────────────────

export type LifecycleHookEvent =
  | "documents_received"
  | "readiness_regressed"
  | "deal_ready_for_review"
  | "missing_documents_detected"
  | "borrower_nudge_failed"
  | "borrower_nudge_exhausted";

export type LifecycleHookInput = {
  dealId: string;
  event: LifecycleHookEvent;
  metadata?: Record<string, unknown>;
  processOutbox?: boolean;
};

export type LifecycleHookResult = {
  event: LifecycleHookEvent;
  dealId: string;
  action: "enqueued" | "skipped" | "failed";
  enqueued: number;
  skipped: number;
  reason?: string;
  outboxIds: string[];
};

type Row = Record<string, unknown>;
type SB = { from: (t: string) => any };

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

const INACTIVE_STATUSES = new Set(["closed", "declined", "funded", "archived", "docs_complete"]);

// ── Event → action mapping ─────────────────────────────────────────────────

const ALERT_EVENTS: Record<string, BankerAlertPurpose> = {
  documents_received: "documents_received",
  readiness_regressed: "readiness_regressed",
  deal_ready_for_review: "deal_ready_for_review",
  borrower_nudge_failed: "borrower_nudge_failed",
  borrower_nudge_exhausted: "borrower_nudge_exhausted",
};

const NUDGE_EVENTS = new Set<LifecycleHookEvent>(["missing_documents_detected"]);

// ── Ledger helpers ─────────────────────────────────────────────────────────

async function emitHookLedger(
  sb: SB,
  eventType: string,
  dealId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  await sb.from("brokerage_comms_ledger").insert({
    event_type: eventType,
    channel: "email",
    deal_id: dealId,
    recipient_masked: "lifecycle_hook",
    metadata,
    created_at: new Date().toISOString(),
  }).then(() => {}, () => {});
}

// ── Core hook processor ────────────────────────────────────────────────────

export async function handleLifecycleHook(
  input: LifecycleHookInput,
  sb: SB,
): Promise<LifecycleHookResult> {
  const { dealId, event, metadata } = input;

  // Ledger: received
  await emitHookLedger(sb, "comms_lifecycle_hook_received", dealId, { event, ...metadata });

  // Gate: check deal is active
  const { data: deal } = await sb
    .from("deals")
    .select("status")
    .eq("id", dealId)
    .maybeSingle();

  const status = str(deal?.status);
  if (!deal) {
    await emitHookLedger(sb, "comms_lifecycle_hook_skipped", dealId, { event, reason: "deal_not_found" });
    return { event, dealId, action: "skipped", enqueued: 0, skipped: 1, reason: "deal_not_found", outboxIds: [] };
  }

  if (status && INACTIVE_STATUSES.has(status)) {
    await emitHookLedger(sb, "comms_lifecycle_hook_skipped", dealId, { event, reason: `deal_status_${status}` });
    return { event, dealId, action: "skipped", enqueued: 0, skipped: 1, reason: `deal_status_${status}`, outboxIds: [] };
  }

  try {
    // Route: borrower nudge events
    if (NUDGE_EVENTS.has(event)) {
      const result = await enqueueBorrowerNudges(dealId, sb);
      if (result.enqueued > 0) {
        await emitHookLedger(sb, "comms_lifecycle_hook_enqueued", dealId, { event, enqueued: result.enqueued, outboxIds: result.outboxIds });
        return { event, dealId, action: "enqueued", enqueued: result.enqueued, skipped: result.skipped, outboxIds: result.outboxIds };
      }
      const reason = result.skipReason ?? "nudge_not_eligible";
      await emitHookLedger(sb, "comms_lifecycle_hook_skipped", dealId, { event, reason });
      return { event, dealId, action: "skipped", enqueued: 0, skipped: 1, reason, outboxIds: [] };
    }

    // Route: banker alert events
    const alertPurpose = ALERT_EVENTS[event];
    if (alertPurpose) {
      const result = await enqueueBankerAlerts(dealId, alertPurpose, sb);
      if (result.enqueued > 0) {
        await emitHookLedger(sb, "comms_lifecycle_hook_enqueued", dealId, { event, purpose: alertPurpose, enqueued: result.enqueued, outboxIds: result.outboxIds });
        return { event, dealId, action: "enqueued", enqueued: result.enqueued, skipped: result.skipped, outboxIds: result.outboxIds };
      }
      const reason = result.skipReason ?? "alert_not_eligible";
      await emitHookLedger(sb, "comms_lifecycle_hook_skipped", dealId, { event, reason });
      return { event, dealId, action: "skipped", enqueued: 0, skipped: 1, reason, outboxIds: [] };
    }

    // Unknown event — should not happen with typed input, but safe fallback
    await emitHookLedger(sb, "comms_lifecycle_hook_skipped", dealId, { event, reason: "unknown_event" });
    return { event, dealId, action: "skipped", enqueued: 0, skipped: 1, reason: "unknown_event", outboxIds: [] };
  } catch (err: any) {
    const reason = str(err?.message) ?? "unknown_error";
    await emitHookLedger(sb, "comms_lifecycle_hook_failed", dealId, { event, error: reason });
    return { event, dealId, action: "failed", enqueued: 0, skipped: 0, reason, outboxIds: [] };
  }
}

// ── Batch helper ───────────────────────────────────────────────────────────

export async function handleLifecycleHookBatch(
  inputs: LifecycleHookInput[],
  sb: SB,
): Promise<LifecycleHookResult[]> {
  const results: LifecycleHookResult[] = [];
  for (const input of inputs) {
    results.push(await handleLifecycleHook(input, sb));
  }
  return results;
}
