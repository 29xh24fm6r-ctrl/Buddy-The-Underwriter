import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { REMINDER_POLICY } from "./policy";
import { reconcileReminderAttempts } from "./reconcileAttempts";

// ⚠️ IMPORTANT: deal_events uses `payload` (jsonb), NOT metadata
// All queries must use payload->>field syntax

/**
 * Get reminder statistics for a deal+borrower combo.
 *
 * A live SMS is persisted in both outbound_messages (delivery state) and
 * deal_events (deal timeline). Reconcile both by provider SID so a partial
 * post-dispatch persistence failure cannot erase the send from cooldown and
 * max-attempt accounting.
 */
export async function getReminderStats(args: { dealId: string; borrowerPhone: string }) {
  const sb = supabaseAdmin();

  const { data: events, error: eventsError } = await sb
    .from("deal_events")
    .select("created_at, payload")
    .eq("deal_id", args.dealId)
    .eq("kind", "sms_outbound")
    .eq("payload->>label", "Upload reminder")
    .order("created_at", { ascending: false });

  if (eventsError) {
    console.error("getReminderStats deal_events error:", eventsError);
    throw new Error("Failed to load reminder event evidence");
  }

  const { data: outbound, error: outboundError } = await sb
    .from("outbound_messages")
    .select("created_at, provider_message_id")
    .eq("deal_id", args.dealId)
    .eq("channel", "sms")
    .eq("to_value", args.borrowerPhone)
    .ilike("body", "Friendly reminder from Buddy%")
    .order("created_at", { ascending: false });

  if (outboundError) {
    console.error("getReminderStats outbound_messages error:", outboundError);
    throw new Error("Failed to load reminder delivery evidence");
  }

  return reconcileReminderAttempts({
    events: events ?? [],
    outbound: outbound ?? [],
  });
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
