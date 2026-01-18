// src/buddy/useBuddyServerSignals.ts
"use client";

import { useEffect, useRef } from "react";
import type { BuddySignal } from "@/buddy/types";

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
    const tickMs = 2500;

    async function poll() {
      if (!alive) return;

      const url = new URL("/api/buddy/signals/latest", window.location.origin);
      if (dealId) url.searchParams.set("dealId", dealId);
      if (sinceISO.current) url.searchParams.set("since", sinceISO.current);
      url.searchParams.set("limit", "50");

      try {
        const res = await fetch(url.toString(), { cache: "no-store" });
        const json = await res.json();
        if (!alive) return;
        if (!json?.ok) return;

        const items = (json.items ?? []) as Array<BuddySignal & { id?: string }>;
        const ordered = items.slice().reverse();

        let maxTs = 0;
        for (const it of ordered) {
          const id = it.id;
          if (id && seen.current.has(id)) continue;
          if (id) seen.current.add(id);

          if (typeof it.ts === "number" && it.ts > maxTs) maxTs = it.ts;
          onSignal(it);
        }

        if (maxTs > 0) {
          sinceISO.current = new Date(maxTs).toISOString();
        }

        if (seen.current.size > 2000) {
          seen.current.clear();
        }
      } catch {
        // ignore
      } finally {
        if (alive) setTimeout(poll, tickMs);
      }
    }

    void poll();
    return () => {
      alive = false;
    };
  }, [dealId, enabled, onSignal]);
}
