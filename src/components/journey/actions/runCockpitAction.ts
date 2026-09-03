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
  // Same call path as the workbench's Re-run Research button; callers pass
  // { force_rerun: true } so a completed/failed mission is not silently reused.
  run_research: (dealId) => `/api/deals/${dealId}/research/run`,
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

    let responseBody: Record<string, unknown> | null = null;
    try {
      const parsed: unknown = await res.json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        responseBody = parsed as Record<string, unknown>;
      }
    } catch {
      // Some successful endpoints intentionally return no JSON body.
    }

    // Transport success is not business-operation success. Several Buddy
    // action routes return a structured { ok: false } contract, so the shared
    // executor must honor that acknowledgement before refreshing the cockpit
    // or showing an optimistic success state.
    if (!res.ok || responseBody?.ok === false) {
      let errorMessage = `HTTP ${res.status}`;
      const candidate =
        responseBody?.error ?? responseBody?.reason ?? responseBody?.message;
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        errorMessage = candidate;
      } else if (
        candidate &&
        typeof candidate === "object" &&
        "message" in candidate
      ) {
        errorMessage = String(
          (candidate as { message?: unknown }).message ?? errorMessage,
        );
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
