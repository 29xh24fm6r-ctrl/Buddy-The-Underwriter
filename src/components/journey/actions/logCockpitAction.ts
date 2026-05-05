/**
 * SPEC-04 — cockpit action telemetry.
 *
 * Writes events to the canonical `buddy_signal_ledger` via the existing
 * `/api/buddy/signals/record` endpoint. Fire-and-forget; never throws.
 *
 * Does NOT introduce a new bespoke action-log table per SPEC-04.
 */
import type {
  CockpitAction,
  CockpitActionResult,
  ServerActionType,
} from "./actionTypes";

export type CockpitTelemetryKind =
  | "cockpit_action_started"
  | "cockpit_action_succeeded"
  | "cockpit_action_failed"
  | "blocker_fix_started"
  | "blocker_fix_succeeded"
  | "blocker_fix_failed"
  | "stage_data_refreshed";

export type CockpitTelemetryEvent = {
  dealId: string;
  lifecycleStage: string | null;
  intent: CockpitAction["intent"] | "stage_refresh";
  actionType?: ServerActionType | null;
  blockerId?: string | null;
  resultStatus: "started" | "succeeded" | "failed";
  errorMessage?: string;
  source: "stage_cockpit";
};

const SIGNAL_RECORD_URL = "/api/buddy/signals/record";

function postSignal(
  kind: CockpitTelemetryKind,
  ev: CockpitTelemetryEvent,
  fetchImpl: typeof fetch = fetch,
): void {
  if (typeof window === "undefined") return;
  try {
    void fetchImpl(SIGNAL_RECORD_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        type: kind,
        source: ev.source,
        dealId: ev.dealId,
        payload: {
          lifecycleStage: ev.lifecycleStage,
          intent: ev.intent,
          actionType: ev.actionType ?? null,
          blockerId: ev.blockerId ?? null,
          resultStatus: ev.resultStatus,
          errorMessage: ev.errorMessage ?? null,
        },
      }),
    }).catch(() => {
      // swallow — telemetry must never break the UI
    });
  } catch {
    // unreachable but keeps TS happy
  }
}

/** Map an action + lifecycle phase to a telemetry kind. */
function kindFor(
  action: CockpitAction,
  phase: "started" | "succeeded" | "failed",
): CockpitTelemetryKind {
  if (action.intent === "fix_blocker") {
    if (phase === "started") return "blocker_fix_started";
    if (phase === "succeeded") return "blocker_fix_succeeded";
    return "blocker_fix_failed";
  }
  if (phase === "started") return "cockpit_action_started";
  if (phase === "succeeded") return "cockpit_action_succeeded";
  return "cockpit_action_failed";
}

export function logCockpitActionStarted(
  action: CockpitAction,
  ctx: { dealId: string; lifecycleStage: string | null },
  fetchImpl: typeof fetch = fetch,
): void {
  postSignal(
    kindFor(action, "started"),
    buildEvent(action, ctx, "started"),
    fetchImpl,
  );
}

export function logCockpitActionResult(
  action: CockpitAction,
  ctx: { dealId: string; lifecycleStage: string | null },
  result: CockpitActionResult,
  fetchImpl: typeof fetch = fetch,
): void {
  const phase = result.ok ? "succeeded" : "failed";
  const ev = buildEvent(action, ctx, phase, result.errorMessage);
  postSignal(kindFor(action, phase), ev, fetchImpl);
}

export function logStageDataRefreshed(
  ctx: { dealId: string; lifecycleStage: string | null },
  fetchImpl: typeof fetch = fetch,
): void {
  postSignal(
    "stage_data_refreshed",
    {
      dealId: ctx.dealId,
      lifecycleStage: ctx.lifecycleStage,
      intent: "stage_refresh",
      resultStatus: "succeeded",
      source: "stage_cockpit",
    },
    fetchImpl,
  );
}

function buildEvent(
  action: CockpitAction,
  ctx: { dealId: string; lifecycleStage: string | null },
  phase: "started" | "succeeded" | "failed",
  errorMessage?: string,
): CockpitTelemetryEvent {
  return {
    dealId: ctx.dealId,
    lifecycleStage: ctx.lifecycleStage,
    intent: action.intent,
    actionType: action.intent === "navigate" ? null : action.actionType,
    blockerId:
      action.intent === "fix_blocker" ? action.blockerId : null,
    resultStatus: phase,
    errorMessage,
    source: "stage_cockpit",
  };
}
