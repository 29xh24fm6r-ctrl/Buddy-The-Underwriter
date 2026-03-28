import "server-only";

/**
 * Phase 65F — Borrower Reminder Scheduling
 *
 * Schedules automatic follow-up reminders for open campaigns.
 * Default cadence: first at 48h, then 72h, then weekly.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { BorrowerReminderCadence } from "./types";

const DEFAULT_FIRST_CADENCE: BorrowerReminderCadence = "48h";

const CADENCE_MS: Record<BorrowerReminderCadence, number> = {
  "24h": 24 * 3600 * 1000,
  "48h": 48 * 3600 * 1000,
  "72h": 72 * 3600 * 1000,
  weekly: 7 * 24 * 3600 * 1000,
  manual: 0,
};

export async function scheduleBorrowerReminders(opts: {
  campaignId: string;
  cadence?: BorrowerReminderCadence;
}): Promise<{ ok: boolean; scheduleId: string | null }> {
  const sb = supabaseAdmin();
  const cadence = opts.cadence ?? DEFAULT_FIRST_CADENCE;

  if (cadence === "manual") {
    return { ok: true, scheduleId: null };
  }

  // Check for existing active schedule
  const { data: existing } = await sb
    .from("borrower_reminder_schedule")
    .select("id")
    .eq("campaign_id", opts.campaignId)
    .eq("is_active", true)
    .maybeSingle();

  if (existing) {
    return { ok: true, scheduleId: existing.id };
  }

  const nextRunAt = new Date(Date.now() + CADENCE_MS[cadence]).toISOString();

  const { data: schedule } = await sb
    .from("borrower_reminder_schedule")
    .insert({
      campaign_id: opts.campaignId,
      next_run_at: nextRunAt,
      cadence,
      is_active: true,
    })
    .select("id")
    .single();

  return { ok: true, scheduleId: schedule?.id ?? null };
}

/**
 * Advance a reminder schedule to the next cadence step after sending.
 */
export async function advanceReminderSchedule(scheduleId: string): Promise<void> {
  const sb = supabaseAdmin();

  const { data: schedule } = await sb
    .from("borrower_reminder_schedule")
    .select("cadence")
    .eq("id", scheduleId)
    .single();

  if (!schedule) return;

  // Escalate cadence: 48h -> 72h -> weekly
  const nextCadence = escalateCadence(schedule.cadence as BorrowerReminderCadence);
  const nextRunAt = new Date(Date.now() + CADENCE_MS[nextCadence]).toISOString();

  await sb
    .from("borrower_reminder_schedule")
    .update({
      cadence: nextCadence,
      next_run_at: nextRunAt,
      last_run_at: new Date().toISOString(),
    })
    .eq("id", scheduleId);
}

function escalateCadence(current: BorrowerReminderCadence): BorrowerReminderCadence {
  switch (current) {
    case "24h":
      return "48h";
    case "48h":
      return "72h";
    case "72h":
      return "weekly";
    default:
      return "weekly";
  }
}
