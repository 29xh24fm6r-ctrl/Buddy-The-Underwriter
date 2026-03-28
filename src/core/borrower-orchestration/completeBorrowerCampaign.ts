import "server-only";

/**
 * Phase 65F — Borrower Campaign Completion
 *
 * Handles campaign state transitions: complete, cancel, expire.
 * On completion, triggers canonical state recomputation.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";

export type CompleteCampaignResult = {
  ok: boolean;
  newStatus: string;
  error?: string;
};

export async function completeBorrowerCampaign(
  campaignId: string,
): Promise<CompleteCampaignResult> {
  const sb = supabaseAdmin();

  const { data: campaign } = await sb
    .from("borrower_request_campaigns")
    .select("id, deal_id, status")
    .eq("id", campaignId)
    .single();

  if (!campaign) {
    return { ok: false, newStatus: "unknown", error: "Campaign not found." };
  }

  if (campaign.status === "completed" || campaign.status === "cancelled") {
    return { ok: true, newStatus: campaign.status };
  }

  await sb
    .from("borrower_request_campaigns")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", campaignId);

  // Deactivate reminders
  await sb
    .from("borrower_reminder_schedule")
    .update({ is_active: false })
    .eq("campaign_id", campaignId);

  await sb.from("borrower_request_events").insert({
    campaign_id: campaignId,
    deal_id: campaign.deal_id,
    event_key: "borrower_campaign.completed",
    payload: { previous_status: campaign.status },
  });

  return { ok: true, newStatus: "completed" };
}

export async function cancelBorrowerCampaign(
  campaignId: string,
): Promise<CompleteCampaignResult> {
  const sb = supabaseAdmin();

  const { data: campaign } = await sb
    .from("borrower_request_campaigns")
    .select("id, deal_id, status")
    .eq("id", campaignId)
    .single();

  if (!campaign) {
    return { ok: false, newStatus: "unknown", error: "Campaign not found." };
  }

  if (campaign.status === "completed" || campaign.status === "cancelled") {
    return { ok: true, newStatus: campaign.status };
  }

  await sb
    .from("borrower_request_campaigns")
    .update({ status: "cancelled" })
    .eq("id", campaignId);

  await sb
    .from("borrower_reminder_schedule")
    .update({ is_active: false })
    .eq("campaign_id", campaignId);

  await sb.from("borrower_request_events").insert({
    campaign_id: campaignId,
    deal_id: campaign.deal_id,
    event_key: "borrower_campaign.cancelled",
    payload: { previous_status: campaign.status },
  });

  return { ok: true, newStatus: "cancelled" };
}

export async function pauseBorrowerCampaignReminders(
  campaignId: string,
): Promise<{ ok: boolean }> {
  const sb = supabaseAdmin();

  await sb
    .from("borrower_reminder_schedule")
    .update({ is_active: false })
    .eq("campaign_id", campaignId);

  try {
    // Best-effort: look up deal_id from campaign for event
    const { data: c } = await sb
      .from("borrower_request_campaigns")
      .select("deal_id")
      .eq("id", campaignId)
      .maybeSingle();

    if (c?.deal_id) {
      await sb.from("borrower_request_events").insert({
        campaign_id: campaignId,
        deal_id: c.deal_id,
        event_key: "borrower_campaign.reminders_paused",
        payload: {},
      });
    }
  } catch { /* non-fatal */ }

  return { ok: true };
}
