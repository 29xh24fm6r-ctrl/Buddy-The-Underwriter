import "server-only";

/**
 * Phase 65G — Borrower Campaign Aging
 *
 * Counts open and overdue borrower campaigns for a deal.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { OBJECT_SLA_POLICY } from "@/core/sla/slaPolicy";

export type CampaignAgingSummary = {
  open: number;
  overdue: number;
  criticalItemsOverdue: number;
};

export async function getBorrowerCampaignAging(
  dealId: string,
): Promise<CampaignAgingSummary> {
  const sb = supabaseAdmin();
  const overdueThreshold = new Date(
    Date.now() - OBJECT_SLA_POLICY.borrowerCampaign.overdueHours * 3600 * 1000,
  ).toISOString();

  // Open campaigns
  const { data: campaigns } = await sb
    .from("borrower_request_campaigns")
    .select("id, created_at, last_sent_at")
    .eq("deal_id", dealId)
    .in("status", ["sent", "in_progress"]);

  const openCount = campaigns?.length ?? 0;
  const overdueCount = (campaigns ?? []).filter((c: any) => {
    const sentAt = c.last_sent_at ?? c.created_at;
    return sentAt < overdueThreshold;
  }).length;

  // Critical overdue items
  const { count: criticalOverdue } = await sb
    .from("borrower_request_items")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", dealId)
    .eq("required", true)
    .in("status", ["pending", "sent"])
    .lt("created_at", overdueThreshold);

  return {
    open: openCount,
    overdue: overdueCount,
    criticalItemsOverdue: criticalOverdue ?? 0,
  };
}
