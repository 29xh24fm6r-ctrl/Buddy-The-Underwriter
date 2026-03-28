import "server-only";

/**
 * Phase 65K — Open Watchlist Case
 *
 * One active watchlist case per deal. Idempotent.
 * Every case must point to evidence.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { WatchlistSeverity, WatchlistReasonCode, WatchlistSourceType } from "./types";

export type OpenWatchlistInput = {
  dealId: string;
  bankId: string;
  severity: WatchlistSeverity;
  primaryReason: WatchlistReasonCode;
  openedBy: string;
  assignedTo?: string | null;
  reasons?: Array<{
    reasonCode: WatchlistReasonCode;
    sourceType: WatchlistSourceType;
    sourceId?: string | null;
    narrative?: string | null;
  }>;
};

export type OpenWatchlistResult = {
  ok: boolean;
  caseId: string | null;
  created: boolean;
  error?: string;
};

export async function openWatchlistCase(input: OpenWatchlistInput): Promise<OpenWatchlistResult> {
  const sb = supabaseAdmin();

  // Single active case per deal
  const { data: existing } = await sb
    .from("deal_watchlist_cases")
    .select("id")
    .eq("deal_id", input.dealId)
    .eq("status", "active")
    .maybeSingle();

  if (existing) {
    return { ok: true, caseId: existing.id, created: false };
  }

  const { data: row, error } = await sb
    .from("deal_watchlist_cases")
    .insert({
      bank_id: input.bankId,
      deal_id: input.dealId,
      status: "active",
      severity: input.severity,
      primary_reason: input.primaryReason,
      opened_by: input.openedBy,
      assigned_to: input.assignedTo ?? null,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: raced } = await sb.from("deal_watchlist_cases").select("id").eq("deal_id", input.dealId).eq("status", "active").single();
      return { ok: true, caseId: raced?.id ?? null, created: false };
    }
    return { ok: false, caseId: null, created: false, error: error.message };
  }

  // Insert reasons
  if (input.reasons && input.reasons.length > 0) {
    await sb.from("deal_watchlist_reasons").insert(
      input.reasons.map((r) => ({
        watchlist_case_id: row.id,
        reason_code: r.reasonCode,
        source_type: r.sourceType,
        source_id: r.sourceId ?? null,
        narrative: r.narrative ?? null,
      })),
    );
  } else {
    await sb.from("deal_watchlist_reasons").insert({
      watchlist_case_id: row.id,
      reason_code: input.primaryReason,
      source_type: "banker_manual",
    });
  }

  // Event
  await sb.from("deal_watchlist_events").insert({
    watchlist_case_id: row.id,
    deal_id: input.dealId,
    event_type: "case_opened",
    actor_user_id: input.openedBy,
    summary: `Watchlist case opened: ${input.primaryReason.replace(/_/g, " ")}`,
    detail: { severity: input.severity, primary_reason: input.primaryReason },
  });

  await sb.from("deal_timeline_events").insert({
    deal_id: input.dealId,
    kind: "watchlist.opened",
    title: "Deal placed on watchlist",
    detail: `Severity: ${input.severity}. Reason: ${input.primaryReason.replace(/_/g, " ")}.`,
    visible_to_borrower: false,
  });

  return { ok: true, caseId: row.id, created: true };
}
