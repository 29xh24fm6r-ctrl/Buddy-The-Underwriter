"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Bulletproof "realtime" for Clerk-based apps:
 * - Polls a server-side "live version" number (max timestamps across deal tables)
 * - Increments refreshKey when version changes
 *
 * Why: Supabase Realtime needs Supabase Auth JWT to respect RLS + deliver scoped events,
 * but Buddy uses Clerk. This approach works immediately and feels realtime.
 */
export function useDealRealtimeRefresh(dealId: string | undefined) {
  const [refreshKey, setRefreshKey] = useState(0);
  const lastVersionRef = useRef<number>(0);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!dealId) return;

    let alive = true;
    let timer: any = null;

    async function tick() {
      try {
        const r = await fetch(`/api/deals/${dealId}/live-version`, { cache: "no-store" });
        if (!r.ok) return;
        const j = await r.json().catch(() => null);
        const v = Number(j?.version || 0);

        if (alive && v && v !== lastVersionRef.current) {
          lastVersionRef.current = v;
          refresh();
        }
      } catch {
        // ignore network blips
      } finally {
        if (alive) timer = setTimeout(tick, 1500);
      }
    }

    tick();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [dealId, refresh]);

  return { refreshKey, refresh };
}
