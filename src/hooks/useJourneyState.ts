"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { LifecycleState } from "@/buddy/lifecycle/model";

const DEFAULT_REVALIDATE_MS = 30_000;

type CacheEntry = {
  state: LifecycleState | null;
  fetchedAt: number;
};

const cache = new Map<string, CacheEntry>();

export type UseJourneyStateResult = {
  state: LifecycleState | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
};

export type UseJourneyStateOptions = {
  initialState?: LifecycleState | null;
  revalidateMs?: number;
};

async function fetchLifecycle(dealId: string): Promise<LifecycleState | null> {
  const res = await fetch(`/api/deals/${dealId}/lifecycle`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`lifecycle fetch failed: ${res.status}`);
  }
  const json = (await res.json()) as { ok?: boolean; state?: LifecycleState };
  return json.state ?? null;
}

/**
 * Subscribes to a deal's lifecycle state.
 *
 * - Uses a module-level cache so multiple consumers share fetches.
 * - Polls every revalidateMs (default 30s) while the document is visible.
 * - Stops polling when the tab is hidden; refetches on visibility return / window focus.
 */
export function useJourneyState(
  dealId: string,
  options?: UseJourneyStateOptions,
): UseJourneyStateResult {
  const { initialState = null, revalidateMs = DEFAULT_REVALIDATE_MS } = options ?? {};

  const seeded = cache.get(dealId)?.state ?? initialState ?? null;
  const [state, setState] = useState<LifecycleState | null>(seeded);
  const [loading, setLoading] = useState<boolean>(!seeded);
  const [error, setError] = useState<Error | null>(null);

  const inflightRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(async () => {
    if (!dealId) return;
    if (inflightRef.current) return;
    inflightRef.current = true;
    try {
      const next = await fetchLifecycle(dealId);
      cache.set(dealId, { state: next, fetchedAt: Date.now() });
      setState(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      inflightRef.current = false;
      setLoading(false);
    }
  }, [dealId]);

  // Seed cache from initialState once.
  useEffect(() => {
    if (!dealId) return;
    if (initialState && !cache.has(dealId)) {
      cache.set(dealId, { state: initialState, fetchedAt: Date.now() });
    }
  }, [dealId, initialState]);

  // Polling loop with visibility/focus integration.
  useEffect(() => {
    if (!dealId) return;

    let cancelled = false;

    const clearTimer = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const schedule = () => {
      clearTimer();
      if (revalidateMs <= 0) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      timerRef.current = setTimeout(async () => {
        if (cancelled) return;
        await refetch();
        if (!cancelled) schedule();
      }, revalidateMs);
    };

    void refetch().then(() => {
      if (!cancelled) schedule();
    });

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        void refetch();
        schedule();
      } else {
        clearTimer();
      }
    };

    const onFocus = () => {
      void refetch();
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }
    if (typeof window !== "undefined") {
      window.addEventListener("focus", onFocus);
    }

    return () => {
      cancelled = true;
      clearTimer();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", onFocus);
      }
    };
  }, [dealId, refetch, revalidateMs]);

  return { state, loading, error, refetch };
}

/** Test-only: clear the module-level cache. */
export function __resetJourneyStateCacheForTests() {
  cache.clear();
}
