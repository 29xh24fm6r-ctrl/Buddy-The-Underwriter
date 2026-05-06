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
  | "stage_data_refreshed"
  | "cockpit_inline_mutation_started"
  | "cockpit_inline_mutation_succeeded"
  | "cockpit_inline_mutation_failed"
  | "cockpit_inline_mutation_undone";

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

function isValidEvent(ev: CockpitTelemetryEvent): boolean {
  if (!ev || typeof ev !== "object") return false;
  if (typeof ev.dealId !== "string" || ev.dealId.length === 0) return false;
  if (
    ev.resultStatus !== "started" &&
    ev.resultStatus !== "succeeded" &&
    ev.resultStatus !== "failed"
  ) {
    return false;
  }
  if (ev.source !== "stage_cockpit") return false;
  return true;
}

function devWarn(message: string, detail?: unknown): void {
  if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
    // Surface in dev so a misconfigured telemetry call is visible during
    // development. Production stays silent.
    console.warn(`[cockpit-telemetry] ${message}`, detail);
  }
}

function postSignal(
  kind: CockpitTelemetryKind,
  ev: CockpitTelemetryEvent,
  fetchImpl: typeof fetch = fetch,
): void {
  if (typeof window === "undefined") return;
  if (!isValidEvent(ev)) {
    devWarn("invalid telemetry payload, dropping", { kind, ev });
    return;
  }
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
    }).catch((err) => {
      devWarn("signal post failed", err);
    });
  } catch (err) {
    devWarn("signal post threw", err);
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

/**
 * SPEC-06 — inline mutation telemetry. Used by ConditionsInlineEditor /
 * OverrideInlineEditor and any other inline edit surface. Always tags
 * source="stage_cockpit" for attribution.
 */
export type InlineMutationKind = "add" | "update" | "status" | "review" | "delete";

export type InlineMutationContext = {
  dealId: string;
  lifecycleStage: string | null;
  /** Domain of the mutation: conditions, overrides, etc. */
  domain: string;
  /** What kind of mutation (add/update/status/review). */
  kind: InlineMutationKind;
  /** Optional id of the affected entity. */
  entityId?: string | null;
};

export function logInlineMutationStarted(
  ctx: InlineMutationContext,
  fetchImpl: typeof fetch = fetch,
): void {
  postSignal(
    "cockpit_inline_mutation_started",
    {
      dealId: ctx.dealId,
      lifecycleStage: ctx.lifecycleStage,
      intent: "fix_blocker",
      actionType: null,
      blockerId: ctx.entityId ?? null,
      resultStatus: "started",
      source: "stage_cockpit",
    },
    fetchImpl,
  );
}

/**
 * SPEC-07 — emit when a banker undoes a recent inline mutation. Tags
 * source="stage_cockpit" like every other inline mutation event.
 */
export function logInlineMutationUndone(
  ctx: InlineMutationContext,
  fetchImpl: typeof fetch = fetch,
): void {
  postSignal(
    "cockpit_inline_mutation_undone",
    {
      dealId: ctx.dealId,
      lifecycleStage: ctx.lifecycleStage,
      intent: "fix_blocker",
      actionType: null,
      blockerId: ctx.entityId ?? null,
      resultStatus: "succeeded",
      source: "stage_cockpit",
    },
    fetchImpl,
  );
}

export function logInlineMutationResult(
  ctx: InlineMutationContext,
  ok: boolean,
  errorMessage?: string,
  fetchImpl: typeof fetch = fetch,
): void {
  postSignal(
    ok ? "cockpit_inline_mutation_succeeded" : "cockpit_inline_mutation_failed",
    {
      dealId: ctx.dealId,
      lifecycleStage: ctx.lifecycleStage,
      intent: "fix_blocker",
      actionType: null,
      blockerId: ctx.entityId ?? null,
      resultStatus: ok ? "succeeded" : "failed",
      errorMessage,
      source: "stage_cockpit",
    },
    fetchImpl,
  );
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
