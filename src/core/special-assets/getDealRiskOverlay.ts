import "server-only";

/**
 * Phase 65K — Deal Risk Overlay Snapshot
 *
 * Single truth for banners, badges, rails, and command center.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { deriveOverlayRecommendation } from "./deriveOverlayRecommendation";
import type { DealRiskOverlay, DealOperatingState } from "./types";

export async function getDealRiskOverlay(dealId: string): Promise<DealRiskOverlay> {
  const sb = supabaseAdmin();

  const [watchlist, workout, actionItems, wlEvents, woEvents, reasons] = await Promise.all([
    sb.from("deal_watchlist_cases").select("id, status, severity, primary_reason")
      .eq("deal_id", dealId).eq("status", "active").maybeSingle(),
    sb.from("deal_workout_cases").select("id, status, severity, stage, workout_strategy")
      .eq("deal_id", dealId).in("status", ["active", "modification_in_process", "forbearance_in_process", "refinance_exit", "liquidation_path", "legal_path"])
      .maybeSingle(),
    sb.from("deal_workout_action_items").select("id, due_at")
      .eq("deal_id", dealId).in("status", ["open", "in_progress", "blocked"]),
    sb.from("deal_watchlist_events").select("event_at")
      .eq("deal_id", dealId).order("event_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("deal_workout_events").select("event_at")
      .eq("deal_id", dealId).order("event_at", { ascending: false }).limit(1).maybeSingle(),
    sb.from("deal_watchlist_reasons").select("reason_code, watchlist_case_id"),
  ]);

  // Determine operating state
  let operatingState: DealOperatingState = "performing";
  if (workout.data) {
    operatingState = "workout";
  } else if (watchlist.data) {
    operatingState = "watchlist";
  }

  // Check if monitored (has monitoring program)
  if (operatingState === "performing") {
    const { data: program } = await sb
      .from("deal_monitoring_programs")
      .select("id")
      .eq("deal_id", dealId)
      .eq("status", "active")
      .maybeSingle();
    if (program) operatingState = "monitored";
  }

  const openItems = actionItems.data ?? [];
  const nextDue = openItems
    .map((i) => i.due_at)
    .filter(Boolean)
    .sort()[0] ?? null;

  const lastEvent = [wlEvents.data?.event_at, woEvents.data?.event_at]
    .filter(Boolean)
    .sort()
    .reverse()[0] ?? null;

  const primaryReasons: string[] = [];
  if (watchlist.data) {
    primaryReasons.push(watchlist.data.primary_reason);
    const caseReasons = (reasons.data ?? [])
      .filter((r) => r.watchlist_case_id === watchlist.data!.id)
      .map((r) => r.reason_code);
    for (const r of caseReasons) {
      if (!primaryReasons.includes(r)) primaryReasons.push(r);
    }
  }

  const recommendation = deriveOverlayRecommendation({
    hasActiveWatchlist: !!watchlist.data,
    hasActiveWorkout: !!workout.data,
    watchlistSeverity: watchlist.data?.severity ?? null,
    openActionItemCount: openItems.length,
  });

  return {
    dealId,
    operatingState,
    activeWatchlistCaseId: watchlist.data?.id ?? null,
    activeWorkoutCaseId: workout.data?.id ?? null,
    severity: workout.data?.severity ?? watchlist.data?.severity ?? null,
    primaryReasons,
    openActionItemCount: openItems.length,
    nextDueAt: nextDue,
    lastMaterialEventAt: lastEvent,
    recommendation,
  };
}
