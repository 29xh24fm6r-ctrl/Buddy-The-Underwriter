"use client";

import { useEffect, useState } from "react";
import type { FinengineSpreadResponse } from "@/lib/finengine/spread/balanceSheetPanelMetrics";

/**
 * SPEC-FINENGINE-BALANCE-SHEET-PANEL-1 §3 — client hook for the gated finengine
 * balance-sheet panel. Calls the read-only route once. The route is dark by default,
 * so for un-flipped tenants this resolves to `{ enabled: false }` and the panel
 * renders nothing. Any error / loading state also yields no panel (no layout shift).
 *
 * This hook is the ONLY data source for Panel F — it never reads `useSpreadOutput`
 * (no cross-engine data flow; the one-engine firewall on the client side).
 */
export function useFinengineSpread(dealId: string): { data: FinengineSpreadResponse | null } {
  const [data, setData] = useState<FinengineSpreadResponse | null>(null);

  useEffect(() => {
    if (!dealId) return;
    let cancelled = false;

    fetch(`/deals/${dealId}/finengine-spread`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setData({ enabled: false });
          return;
        }
        setData((await res.json()) as FinengineSpreadResponse);
      })
      .catch(() => {
        if (!cancelled) setData({ enabled: false });
      });

    return () => { cancelled = true; };
  }, [dealId]);

  return { data };
}
