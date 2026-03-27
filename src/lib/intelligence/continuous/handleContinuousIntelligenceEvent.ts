import "server-only";

/**
 * Phase 61 — Continuous Intelligence Event Handler
 *
 * Receives deal change events, evaluates whether re-analysis is needed,
 * applies debounce + active-run guard, and routes into the existing
 * Phase 58B auto-intelligence pipeline. No new run tables or UI.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { shouldTriggerReanalysis, type ContinuousEvent, type ReanalysisScope } from "./shouldTriggerReanalysis";
import { enqueueAutoIntelligenceRun } from "@/lib/intelligence/auto/enqueueAutoIntelligenceRun";

// Debounce window: suppress duplicate triggers within this period
const DEBOUNCE_WINDOW_MS = 30_000; // 30 seconds

// In-memory debounce map (per-process; resets on deploy)
const recentTriggers = new Map<string, number>();

type HandleResult = {
  action: "triggered" | "suppressed" | "debounced" | "deferred";
  reason: string;
  runId?: string;
  scope?: ReanalysisScope;
};

/**
 * Handle a continuous intelligence event.
 * Evaluates trigger → debounce → active-run guard → enqueue.
 */
export async function handleContinuousIntelligenceEvent(
  event: ContinuousEvent,
  opts?: { bankId?: string },
): Promise<HandleResult> {
  const decision = shouldTriggerReanalysis(event);

  // 1. Should we trigger at all?
  if (!decision.shouldTrigger) {
    return { action: "suppressed", reason: decision.reason };
  }

  // 2. Debounce check
  const now = Date.now();
  const lastTrigger = recentTriggers.get(decision.debounceKey);
  if (lastTrigger && now - lastTrigger < DEBOUNCE_WINDOW_MS) {
    await logLedgerEvent({
      dealId: event.dealId,
      bankId: opts?.bankId ?? "system",
      eventKey: "continuous_intelligence.debounced",
      uiState: "done",
      uiMessage: "Re-analysis debounced (recent trigger exists)",
      meta: { event_type: event.type, debounce_key: decision.debounceKey, scope: decision.scope },
    }).catch(() => {});

    return { action: "debounced", reason: `Debounced — last trigger ${Math.round((now - lastTrigger) / 1000)}s ago`, scope: decision.scope };
  }

  // 3. Resolve bankId if not provided
  let bankId: string = opts?.bankId ?? "";
  if (!bankId) {
    const sb = supabaseAdmin();
    const { data: deal } = await sb.from("deals").select("bank_id").eq("id", event.dealId).maybeSingle();
    bankId = (deal as any)?.bank_id ?? "system";
  }

  // 4. Enqueue through existing auto-intelligence pipeline
  const enqueueResult = await enqueueAutoIntelligenceRun({
    dealId: event.dealId,
    bankId,
    source: "system_repair",
    createdBy: null,
  });

  if (!enqueueResult.ok) {
    return { action: "suppressed", reason: `Enqueue failed: ${enqueueResult.error}` };
  }

  // 5. Active run guard (already handled by enqueue idempotency)
  if (enqueueResult.alreadyActive) {
    await logLedgerEvent({
      dealId: event.dealId,
      bankId,
      eventKey: "continuous_intelligence.deferred",
      uiState: "done",
      uiMessage: "Re-analysis deferred — active run in progress",
      meta: { event_type: event.type, existing_run_id: enqueueResult.runId, scope: decision.scope },
    }).catch(() => {});

    return { action: "deferred", reason: "Active intelligence run already in progress", runId: enqueueResult.runId, scope: decision.scope };
  }

  // 6. Record trigger in debounce map
  recentTriggers.set(decision.debounceKey, now);

  // 7. Audit
  await logLedgerEvent({
    dealId: event.dealId,
    bankId,
    eventKey: "continuous_intelligence.triggered",
    uiState: "working",
    uiMessage: `Re-analysis triggered: ${decision.reason}`,
    meta: {
      event_type: event.type,
      scope: decision.scope,
      run_id: enqueueResult.runId,
      debounce_key: decision.debounceKey,
    },
  }).catch(() => {});

  return { action: "triggered", reason: decision.reason, runId: enqueueResult.runId, scope: decision.scope };
}
