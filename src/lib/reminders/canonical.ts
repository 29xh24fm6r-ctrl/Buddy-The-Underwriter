// src/lib/reminders/canonical.ts
import { SupabaseClient } from "@supabase/supabase-js";

export type DueReminderSubscription = {
  id: string;
  deal_id: string;
  active: boolean;
  next_run_at: string;
  channel: string | null;
  to_email: string | null;
  to_phone: string | null;
  missing_only: boolean | null;
};

export async function fetchDueReminderSubscriptions(
  sb: SupabaseClient,
  args: { limit?: number; nowIso?: string } = {}
): Promise<DueReminderSubscription[]> {
  const limit = args.limit ?? 50;
  const nowIso = args.nowIso ?? new Date().toISOString();

  const { data, error } = await sb
    .from("deal_reminder_subscriptions")
    .select("id, deal_id, active, next_run_at, channel, to_email, to_phone, missing_only")
    .eq("active", true)
    .lte("next_run_at", nowIso)
    .order("next_run_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as DueReminderSubscription[];
}
