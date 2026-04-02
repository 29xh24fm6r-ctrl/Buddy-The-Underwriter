/**
 * Evidence Drilldown Analytics — Phase 66C, System 4
 *
 * Tracks which evidence conclusions bankers drill into most, surfacing
 * areas where Buddy's explanations need more depth or clarity.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type DrilldownAnalysis = {
  totalDrilldowns: number;
  topDrilledConclusions: {
    conclusionKey: string;
    count: number;
  }[];
  avgDrilldownsPerDeal: number;
};

/* ------------------------------------------------------------------ */
/*  analyzeDrilldowns                                                  */
/* ------------------------------------------------------------------ */

export async function analyzeDrilldowns(
  sb: SupabaseClient,
  bankId: string,
  options?: { days?: number },
): Promise<DrilldownAnalysis> {
  const days = options?.days ?? 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await sb
    .from("buddy_banker_trust_events")
    .select("conclusion_key, deal_id")
    .eq("bank_id", bankId)
    .eq("event_type", "evidence_drilldown")
    .gte("created_at", since);

  if (error || !data) {
    console.error("[evidenceDrilldownAnalytics] query failed:", error?.message);
    return { totalDrilldowns: 0, topDrilledConclusions: [], avgDrilldownsPerDeal: 0 };
  }

  /* Group by conclusion_key */
  const grouped = new Map<string, number>();
  const dealIds = new Set<string>();

  for (const row of data) {
    const key = row.conclusion_key ?? "unknown";
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
    if (row.deal_id) dealIds.add(row.deal_id);
  }

  const topDrilledConclusions = [...grouped.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([conclusionKey, count]) => ({ conclusionKey, count }));

  const uniqueDeals = dealIds.size;

  return {
    totalDrilldowns: data.length,
    topDrilledConclusions,
    avgDrilldownsPerDeal: uniqueDeals > 0 ? data.length / uniqueDeals : 0,
  };
}
