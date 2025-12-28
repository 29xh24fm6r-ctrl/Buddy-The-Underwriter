import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { REMINDER_POLICY } from "./policy";

/**
 * Get reminder statistics for a deal+borrower combo
 * Checks outbound_messages table for reminder sends
 */
export async function getReminderStats(args: { dealId: string; borrowerPhone: string }) {
  const sb = supabaseAdmin();

  // All reminder sends are recorded in outbound_messages with body containing "reminder"
  // We track this via deal_events with kind='sms_outbound' and metadata.label='reminder'
  const { data, error } = await sb
    .from("deal_events")
    .select("created_at, metadata")
    .eq("deal_id", args.dealId)
    .eq("kind", "sms_outbound")
    .eq("metadata->>label", "Upload reminder")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getReminderStats error:", error);
    throw new Error(`getReminderStats failed: ${error.message}`);
  }

  const attempts = data?.length ?? 0;
  const lastAt = data?.[0]?.created_at ?? null;

  return { attempts, lastAt };
}

/**
 * Check if cooldown period has passed since last reminder
 */
export function isCooldownSatisfied(lastAtIso: string | null) {
  if (!lastAtIso) return true;
  const last = new Date(lastAtIso).getTime();
  const now = Date.now();
  const hours = (now - last) / (1000 * 60 * 60);
  return hours >= REMINDER_POLICY.cooldownHours;
}

/**
 * Check if we haven't exceeded max attempts
 */
export function isAttemptsSatisfied(attempts: number) {
  return attempts < REMINDER_POLICY.maxAttempts;
}
