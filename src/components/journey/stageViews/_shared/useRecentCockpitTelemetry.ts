"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useStageDataContext } from "./StageDataProvider";
import type { AdvisorTelemetryEvent } from "@/lib/journey/advisor/buildCockpitAdvisorSignals";

/**
 * SPEC-08 — fetches recent cockpit-relevant telemetry for the active deal.
 *
 * Data source: existing /api/buddy/signals/latest endpoint, which already
 * accepts dealId + limit. We pre-filter cockpit families on the client so
 * the advisor never sees unrelated event noise.
 *
 * Cockpit-relevant families (anchored at start of `type`):
 *   cockpit_action_*
 *   blocker_fix_*
 *   cockpit_inline_mutation_*
 *   stage_data_refreshed
 *
 * The hook auto-registers a refresher under the SPEC-06 stage-data
 * provider so a successful cockpit action / inline mutation re-fetches
 * telemetry when the parent stage refreshes.
 */

const COCKPIT_FAMILIES: ReadonlyArray<string> = [
  "cockpit_action_",
  "blocker_fix_",
  "cockpit_inline_mutation_",
];

/**
 * Returns true when the given telemetry `type` is one of the cockpit
 * families the advisor cares about.
 */
export function isCockpitTelemetryType(type: string | null | undefined): boolean {
  if (!type) return false;
  if (type === "stage_data_refreshed") return true;
  for (const prefix of COCKPIT_FAMILIES) {
    if (type.startsWith(prefix)) return true;
  }
  return false;
}

type RawSignalRow = {
  id: string;
  ts: number;
  type: string;
  source?: string | null;
  dealId?: string | null;
  payload?: Record<string, unknown> | null;
};

type SignalsLatestApi = {
  ok?: boolean;
  items?: RawSignalRow[];
};

export type UseRecentCockpitTelemetryResult = {
  events: AdvisorTelemetryEvent[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

export type UseRecentCockpitTelemetryOptions = {
  /** Maximum signals to request. Default 25, max 200. */
  limit?: number;
  /** When false, skip fetching entirely. */
  enabled?: boolean;
};

export function useRecentCockpitTelemetry(
  dealId: string | null,
  options?: UseRecentCockpitTelemetryOptions,
): UseRecentCockpitTelemetryResult {
  const { limit = 25, enabled = true } = options ?? {};
  const [events, setEvents] = useState<AdvisorTelemetryEvent[]>([]);
  const [loading, setLoading] = useState<boolean>(Boolean(enabled && dealId));
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef<AbortController | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    if (!enabled || !dealId) {
      setLoading(false);
      return;
    }
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const url = `/api/buddy/signals/latest?dealId=${encodeURIComponent(
        dealId,
      )}&limit=${limit}`;
      const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
        return;
      }
      const json = (await res.json()) as SignalsLatestApi;
      const items = json.items ?? [];

      // Filter:
      //  1. only cockpit families
      //  2. only events tagged for THIS deal (defense-in-depth even though
      //     the endpoint already filters by dealId)
      // SPEC-10: lifecycleStage is now a first-class field on the emitted
      // event so the stage_oscillation pattern detector works against the
      // live telemetry stream, not just typed test fixtures.
      const filtered: AdvisorTelemetryEvent[] = items
        .filter((row) => {
          if (!isCockpitTelemetryType(row.type)) return false;
          if (row.dealId && row.dealId !== dealId) return false;
          return true;
        })
        .map((row) => ({
          type: row.type,
          ts: typeof row.ts === "number" ? row.ts : Number(row.ts),
          label: extractLabel(row.payload),
          lifecycleStage:
            typeof row.payload?.lifecycleStage === "string"
              ? (row.payload.lifecycleStage as string)
              : null,
        }));

      setEvents(filtered);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message ?? "fetch_failed");
    } finally {
      if (inflight.current === ctrl) setLoading(false);
    }
  }, [dealId, limit, enabled]);

  // Initial fetch + dealId change.
  useEffect(() => {
    void refresh();
    return () => {
      inflight.current?.abort();
    };
  }, [refresh]);

  // Auto-register so a stage refresh also re-pulls telemetry.
  // Telemetry refresh is fire-and-forget — we don't await it from the
  // mutation runner; this hook re-runs it on stage refresh tick.
  const { registerRefresher } = useStageDataContext();
  useEffect(() => {
    if (!enabled || !dealId) return;
    return registerRefresher("all", "advisor:telemetry", () => {
      void refresh();
    });
  }, [registerRefresher, refresh, enabled, dealId]);

  return { events, loading, error, refresh };
}

function extractLabel(payload?: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  // Telemetry payloads include actionType/blockerId/lifecycleStage; pick
  // the most human-friendly tag we can find.
  const actionType = payload.actionType;
  const blockerId = payload.blockerId;
  const stage = payload.lifecycleStage;
  if (typeof actionType === "string" && actionType) return actionType;
  if (typeof blockerId === "string" && blockerId) return blockerId;
  if (typeof stage === "string" && stage) return stage;
  return null;
}
