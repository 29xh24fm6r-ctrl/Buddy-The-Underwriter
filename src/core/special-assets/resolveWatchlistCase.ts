import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

export type ResolveWatchlistInput = {
  watchlistCaseId: string;
  dealId: string;
  resolvedBy: string;
  resolutionSummary: string;
  newStatus?: "resolved" | "dismissed";
};

export async function resolveWatchlistCase(input: ResolveWatchlistInput) {
  const sb = supabaseAdmin();
  const now = new Date().toISOString();
  const status = input.newStatus ?? "resolved";

  await sb.from("deal_watchlist_cases").update({
    status,
    resolution_summary: input.resolutionSummary,
    resolved_at: now,
    updated_at: now,
  }).eq("id", input.watchlistCaseId);

  await sb.from("deal_watchlist_events").insert({
    watchlist_case_id: input.watchlistCaseId,
    deal_id: input.dealId,
    event_type: status === "dismissed" ? "dismissed" : "resolved",
    actor_user_id: input.resolvedBy,
    summary: `Watchlist case ${status}: ${input.resolutionSummary}`,
  });

  await sb.from("deal_timeline_events").insert({
    deal_id: input.dealId,
    kind: "watchlist.resolved",
    title: `Watchlist case ${status}`,
    detail: input.resolutionSummary,
    visible_to_borrower: false,
  });

  return { ok: true };
}
