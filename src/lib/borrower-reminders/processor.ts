import "server-only";

/**
 * Phase 65F — Borrower Campaign Reminder Processor
 *
 * Processes due reminders for active borrower campaigns.
 * Respects cadence, skips completed/cancelled campaigns.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendBorrowerCampaign } from "@/core/borrower-orchestration/sendBorrowerCampaign";
import { advanceReminderSchedule } from "@/core/borrower-orchestration/scheduleBorrowerReminders";

export type ReminderProcessorResult = {
  processed: number;
  sent: number;
  skipped: number;
  results: Array<{
    campaignId: string;
    action: "sent" | "skipped";
    reason?: string;
  }>;
};

export async function processBorrowerReminders(): Promise<ReminderProcessorResult> {
  const sb = supabaseAdmin();
  const now = new Date().toISOString();

  // Find due reminders
  const { data: dueSchedules } = await sb
    .from("borrower_reminder_schedule")
    .select("id, campaign_id")
    .eq("is_active", true)
    .lte("next_run_at", now)
    .limit(50);

  if (!dueSchedules || dueSchedules.length === 0) {
    return { processed: 0, sent: 0, skipped: 0, results: [] };
  }

  const results: ReminderProcessorResult["results"] = [];
  let sent = 0;
  let skipped = 0;

  for (const schedule of dueSchedules) {
    // Check campaign is still active
    const { data: campaign } = await sb
      .from("borrower_request_campaigns")
      .select("id, deal_id, bank_id, status")
      .eq("id", schedule.campaign_id)
      .single();

    if (!campaign || campaign.status === "completed" || campaign.status === "cancelled" || campaign.status === "expired") {
      // Deactivate stale schedule
      await sb
        .from("borrower_reminder_schedule")
        .update({ is_active: false })
        .eq("id", schedule.id);

      results.push({
        campaignId: schedule.campaign_id,
        action: "skipped",
        reason: `campaign_${campaign?.status ?? "not_found"}`,
      });
      skipped++;
      continue;
    }

    // Check if there are still pending required items
    const { count: pendingCount } = await sb
      .from("borrower_request_items")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", schedule.campaign_id)
      .eq("required", true)
      .not("status", "in", '("completed","waived")');

    if ((pendingCount ?? 0) === 0) {
      await sb
        .from("borrower_reminder_schedule")
        .update({ is_active: false })
        .eq("id", schedule.id);

      results.push({
        campaignId: schedule.campaign_id,
        action: "skipped",
        reason: "all_items_complete",
      });
      skipped++;
      continue;
    }

    // Send reminder
    const sendResult = await sendBorrowerCampaign({
      campaignId: schedule.campaign_id,
      dealId: campaign.deal_id,
      bankId: campaign.bank_id,
    });

    if (sendResult.ok && (sendResult.smsSent || sendResult.emailSent)) {
      // Record reminder event
      await sb.from("borrower_request_events").insert({
        campaign_id: schedule.campaign_id,
        deal_id: campaign.deal_id,
        event_key: "borrower_campaign.reminder_sent",
        payload: {
          sms_sent: sendResult.smsSent,
          email_sent: sendResult.emailSent,
        },
      });

      // Advance to next cadence
      await advanceReminderSchedule(schedule.id);

      results.push({ campaignId: schedule.campaign_id, action: "sent" });
      sent++;
    } else {
      results.push({
        campaignId: schedule.campaign_id,
        action: "skipped",
        reason: sendResult.error ?? "send_failed",
      });
      skipped++;
    }
  }

  return {
    processed: dueSchedules.length,
    sent,
    skipped,
    results,
  };
}
