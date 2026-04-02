/**
 * Override Analytics — Phase 66C, System 4
 *
 * Analyzes patterns in banker overrides to surface which Buddy conclusions
 * are most frequently overridden and the common reasons behind them.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type OverrideAnalysis = {
  totalOverrides: number;
  topOverriddenConclusions: {
    conclusionKey: string;
    count: number;
    commonReasons: string[];
  }[];
  overrideRate: number;
};

/* ------------------------------------------------------------------ */
/*  analyzeOverrides                                                   */
/* ------------------------------------------------------------------ */

export async function analyzeOverrides(
  sb: SupabaseClient,
  bankId: string,
  options?: { days?: number },
): Promise<OverrideAnalysis> {
  const days = options?.days ?? 30;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  /* Fetch all override events for this bank in the window */
  const { data: overrides, error: overrideErr } = await sb
    .from("buddy_banker_trust_events")
    .select("conclusion_key, payload")
    .eq("bank_id", bankId)
    .eq("event_type", "override")
    .gte("created_at", since);

  if (overrideErr || !overrides) {
    console.error("[overrideAnalytics] query failed:", overrideErr?.message);
    return { totalOverrides: 0, topOverriddenConclusions: [], overrideRate: 0 };
  }

  /* Fetch total events in same window for rate calculation */
  const { count: totalCount, error: countErr } = await sb
    .from("buddy_banker_trust_events")
    .select("id", { count: "exact", head: true })
    .eq("bank_id", bankId)
    .gte("created_at", since);

  if (countErr) {
    console.error("[overrideAnalytics] count query failed:", countErr.message);
  }

  const total = totalCount ?? 0;

  /* Group by conclusion_key */
  const grouped = new Map<string, { count: number; reasons: Map<string, number> }>();

  for (const row of overrides) {
    const key = row.conclusion_key ?? "unknown";
    let entry = grouped.get(key);
    if (!entry) {
      entry = { count: 0, reasons: new Map() };
      grouped.set(key, entry);
    }
    entry.count++;

    const reason = (row.payload as Record<string, unknown> | null)?.reason;
    if (typeof reason === "string" && reason.length > 0) {
      entry.reasons.set(reason, (entry.reasons.get(reason) ?? 0) + 1);
    }
  }

  /* Sort by count descending, take top 10 */
  const topOverriddenConclusions = [...grouped.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10)
    .map(([conclusionKey, { count, reasons }]) => ({
      conclusionKey,
      count,
      commonReasons: [...reasons.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([r]) => r),
    }));

  return {
    totalOverrides: overrides.length,
    topOverriddenConclusions,
    overrideRate: total > 0 ? overrides.length / total : 0,
  };
}
