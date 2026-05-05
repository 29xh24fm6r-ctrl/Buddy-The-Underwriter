"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRegisterStageRefresher } from "./useStageDataRefresh";
import type { StageRefreshScope } from "./StageDataProvider";

/**
 * SPEC-05 — shared stage data hook.
 *
 * - Owns a single fetch + refresh cycle for stage-owned JSON resources.
 * - Registers itself with the StageDataProvider so a successful cockpit
 *   action triggers `refresh()` automatically.
 * - Exposes `setOptimisticData` for "show success immediately, reconcile
 *   on next refresh" UX.
 * - Aborts in-flight requests on unmount + URL change.
 * - Never throws; surfaces errors via `error`.
 *
 * SPEC-06: optional `scope` registers the refresher in a specific bucket
 * so scoped `refreshStageData("conditions")` only triggers conditions
 * fetches.
 */
export type StageJsonResource<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setOptimisticData: (updater: (current: T | null) => T | null) => void;
};

export type UseStageJsonResourceOptions = {
  /** Stable identifier; required for stage-data-provider registration. */
  id: string;
  /** When false, skip fetching (e.g. waiting on an upstream prerequisite). */
  enabled?: boolean;
  /** SPEC-06 — refresh scope this resource belongs to. Default: "all". */
  scope?: StageRefreshScope;
};

const NULL_RESPONSE = Symbol("NULL_RESPONSE");

export function useStageJsonResource<T>(
  url: string | null,
  { id, enabled = true, scope = "all" }: UseStageJsonResourceOptions,
): StageJsonResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(enabled && url));
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef<AbortController | null>(null);

  const fetchOnce = useCallback(async (): Promise<void> => {
    if (!enabled || !url) {
      setLoading(false);
      return;
    }
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
      if (!res.ok) {
        const msg = await safeErrorBody(res);
        setError(msg || `HTTP ${res.status}`);
        return;
      }
      const json = (await res.json()) as T | typeof NULL_RESPONSE;
      if (json !== NULL_RESPONSE) setData(json);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      setError((err as Error).message ?? "fetch_failed");
    } finally {
      // Only flip loading off if we're still the current request.
      if (inflight.current === ctrl) {
        setLoading(false);
      }
    }
  }, [url, enabled]);

  // Initial fetch + URL change.
  useEffect(() => {
    void fetchOnce();
    return () => {
      inflight.current?.abort();
    };
  }, [fetchOnce]);

  // Register with the stage data provider so cockpit actions refresh us.
  // SPEC-06: scope-aware so `refreshStageData("conditions")` only re-runs
  // conditions resources.
  useRegisterStageRefresher(scope, id, fetchOnce);

  const setOptimisticData = useCallback(
    (updater: (current: T | null) => T | null) => {
      setData((prev) => updater(prev));
    },
    [],
  );

  return {
    data,
    loading,
    error,
    refresh: fetchOnce,
    setOptimisticData,
  };
}

async function safeErrorBody(res: Response): Promise<string | null> {
  try {
    const text = await res.text();
    if (!text) return null;
    try {
      const json = JSON.parse(text);
      if (json && typeof json === "object") {
        if (typeof (json as { error?: unknown }).error === "string") {
          return (json as { error: string }).error;
        }
        if (
          (json as { error?: { message?: unknown } }).error &&
          typeof (json as { error: { message?: unknown } }).error.message === "string"
        ) {
          return (json as { error: { message: string } }).error.message;
        }
      }
      return text.slice(0, 200);
    } catch {
      return text.slice(0, 200);
    }
  } catch {
    return null;
  }
}
