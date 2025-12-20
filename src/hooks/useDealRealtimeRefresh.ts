"use client";

import { useEffect, useState, useCallback } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

/**
 * Hook to trigger a refresh whenever Postgres changes occur for a deal.
 * Listens to: deal_missing_docs, deal_conditions, deal_condition_evidence, borrower_portal_events
 */
export function useDealRealtimeRefresh(dealId: string | undefined) {
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!dealId) return;

    const supabase = getSupabaseBrowserClient();
    const channelName = `deal:${dealId}:changes`;

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "deal_missing_docs", filter: `deal_id=eq.${dealId}` },
        () => {
          console.log("[useDealRealtimeRefresh] missing_docs changed");
          refresh();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "deal_conditions", filter: `deal_id=eq.${dealId}` },
        () => {
          console.log("[useDealRealtimeRefresh] conditions changed");
          refresh();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "deal_condition_evidence", filter: `deal_id=eq.${dealId}` },
        () => {
          console.log("[useDealRealtimeRefresh] condition_evidence changed");
          refresh();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "borrower_portal_events", filter: `deal_id=eq.${dealId}` },
        () => {
          console.log("[useDealRealtimeRefresh] portal_events changed");
          refresh();
        }
      )
      .subscribe((status: string) => {
        console.log("[useDealRealtimeRefresh] subscription status:", status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [dealId, refresh]);

  return { refreshKey, refresh };
}
