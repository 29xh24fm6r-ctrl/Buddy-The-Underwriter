// src/buddy/useBuddyServerSignals.ts
"use client";

import { useEffect, useRef } from "react";
import type { BuddySignal } from "@/buddy/types";
import {
  BUDDY_SIGNAL_FETCH_TIMEOUT_MS,
  getBuddySignalPollDelay,
} from "@/buddy/serverSignalPolling";

export function useBuddyServerSignals(opts: {
  dealId?: string | null;
  enabled: boolean;
  onSignal: (sig: BuddySignal & { id?: string }) => void;
}) {
  const { dealId, enabled, onSignal } = opts;
  const seen = useRef<Set<string>>(new Set());
  const sinceISO = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let alive = true;
    let consecutiveErrors = 0;
    let consecutiveEmptyPolls = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inflight: AbortController | null = null;

    function schedule(delay: number) {
      if (!alive || document.hidden) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void poll();
      }, delay);
    }

    async function poll() {
      if (!alive || document.hidden) return;

      const url = new URL("/api/buddy/signals/latest", window.location.origin);
      if (dealId) url.searchParams.set("dealId", dealId);
      if (sinceISO.current) url.searchParams.set("since", sinceISO.current);
      url.searchParams.set("limit", "50");

      const ctrl = new AbortController();
      inflight = ctrl;
      const deadline = setTimeout(
        () => ctrl.abort(),
        BUDDY_SIGNAL_FETCH_TIMEOUT_MS,
      );

      try {
        const res = await fetch(url.toString(), {
          cache: "no-store",
          signal: ctrl.signal,
        });
        const json = await res.json();
        if (!alive) return;
        if (!json?.ok) {
          consecutiveErrors++;
          consecutiveEmptyPolls = 0;
          return;
        }

        consecutiveErrors = 0;

        const items = (json.items ?? []) as Array<BuddySignal & { id?: string }>;
        const ordered = items.slice().reverse();

        let maxTs = 0;
        let delivered = 0;
        for (const it of ordered) {
          const id = it.id;
          if (id && seen.current.has(id)) continue;
          if (id) seen.current.add(id);

          if (typeof it.ts === "number" && it.ts > maxTs) maxTs = it.ts;
          delivered++;
          onSignal(it);
        }

        consecutiveEmptyPolls =
          delivered === 0 ? Math.min(consecutiveEmptyPolls + 1, 10) : 0;

        if (maxTs > 0) {
          sinceISO.current = new Date(maxTs).toISOString();
        }

        if (seen.current.size > 2000) {
          seen.current.clear();
        }
      } catch (error) {
        if (!alive) return;
        if ((error as Error).name === "AbortError" && document.hidden) return;
        consecutiveErrors++;
        consecutiveEmptyPolls = 0;
      } finally {
        clearTimeout(deadline);
        if (inflight === ctrl) inflight = null;
        if (alive && !document.hidden) {
          schedule(
            getBuddySignalPollDelay({
              consecutiveErrors,
              consecutiveEmptyPolls,
            }),
          );
        }
      }
    }

    function onVisibilityChange() {
      if (document.hidden) {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        inflight?.abort();
        return;
      }

      consecutiveErrors = 0;
      schedule(0);
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    void poll();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      inflight?.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [dealId, enabled, onSignal]);
}
