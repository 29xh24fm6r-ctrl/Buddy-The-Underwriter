/**
 * SPEC-04 — pure action executor.
 *
 * Maps a `CockpitAction` to an HTTP call (or no-op for navigate). Returns a
 * uniform `CockpitActionResult`. Does NOT dispatch telemetry, refresh stage
 * data, or navigate — those concerns belong to `useCockpitAction`.
 */
import type {
  CockpitAction,
  CockpitActionResult,
  ServerActionType,
} from "./actionTypes";

/**
 * Endpoint table for runnable / fix-blocker actions. Keep in sync with
 * existing server routes — SPEC-04 reuses what's already deployed.
 *
 * SPEC-05: hardened with an `unknown actionType` guard so a typo never
 * silently calls `/api/deals/[dealId]/undefined`.
 */
const ACTION_ENDPOINT: Record<ServerActionType, (dealId: string) => string> = {
  generate_packet: (dealId) =>
    `/api/deals/${dealId}/committee/packet/generate`,
  generate_snapshot: (dealId) =>
    `/api/deals/${dealId}/financial-snapshot/recompute`,
  run_ai_classification: (dealId) =>
    `/api/deals/${dealId}/artifacts/process`,
  send_reminder: (dealId) =>
    `/api/deals/${dealId}/notifications/remind`,
};

const KNOWN_ACTION_TYPES: ReadonlySet<string> = new Set(
  Object.keys(ACTION_ENDPOINT),
);

export function endpointFor(actionType: ServerActionType, dealId: string): string {
  const builder = ACTION_ENDPOINT[actionType];
  if (!builder) {
    throw new Error(`unknown_action_type:${String(actionType)}`);
  }
  return builder(dealId);
}

/** Exposed for tests. */
export function isKnownActionType(actionType: string): boolean {
  return KNOWN_ACTION_TYPES.has(actionType);
}

/**
 * Execute a `CockpitAction`. Navigate intents return ok=true without doing
 * any work — the caller (useCockpitAction) is responsible for router.push.
 *
 * SPEC-05: unknown `actionType` returns a structured error WITHOUT calling
 * fetch, so a typo can't accidentally hit a wrong URL.
 */
export async function runCockpitAction(
  action: CockpitAction,
  dealId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CockpitActionResult> {
  if (action.intent === "navigate") {
    return { ok: true, status: "ok" };
  }

  if (!isKnownActionType(action.actionType)) {
    return {
      ok: false,
      status: "error",
      errorMessage: `unknown_action_type:${String(action.actionType)}`,
    };
  }

  const endpoint = endpointFor(action.actionType, dealId);

  try {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...(action.payload ?? {}),
        // Tag the request so server logs can attribute the source.
        source: "stage_cockpit",
        intent: action.intent,
        ...(action.intent === "fix_blocker"
          ? { blockerId: action.blockerId }
          : {}),
      }),
    });

    if (!res.ok) {
      let errorMessage = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body && typeof body === "object" && "error" in body) {
          const err = (body as { error?: unknown }).error;
          if (typeof err === "string") errorMessage = err;
          else if (err && typeof err === "object" && "message" in err) {
            errorMessage = String((err as { message?: unknown }).message ?? errorMessage);
          }
        }
      } catch {
        // body wasn't JSON; keep HTTP status text
      }
      return {
        ok: false,
        status: "error",
        errorMessage,
        endpoint,
        httpStatus: res.status,
      };
    }

    return { ok: true, status: "ok", endpoint, httpStatus: res.status };
  } catch (err) {
    return {
      ok: false,
      status: "error",
      errorMessage: (err as Error).message ?? "fetch_failed",
      endpoint,
    };
  }
}
