// Throttle Gate (Rules-Based)
// Prevents message spam

import { supabaseAdmin } from "@/lib/supabase/admin";

export type ThrottleResult = {
  eligible: boolean;
  reason?: string;
  next_eligible_at?: string;
  send_count?: number;
  last_sent_at?: string;
};

export type ThrottlePolicy = {
  min_hours_between_sends: number;
  max_sends_per_week: number;
  max_sends_per_month: number;
};

const DEFAULT_POLICY: ThrottlePolicy = {
  min_hours_between_sends: 48, // 2 days minimum between messages
  max_sends_per_week: 2,
  max_sends_per_month: 6,
};

export async function checkThrottle(
  applicationId: string,
  conditionId: string,
  triggerType: string,
  policy: ThrottlePolicy = DEFAULT_POLICY
): Promise<ThrottleResult> {
  const sb = supabaseAdmin();
  const now = new Date();

  // Get existing throttle record
  const { data: throttle } = await (sb as any)
    .from("condition_message_throttles")
    .select("*")
    .eq("application_id", applicationId)
    .eq("condition_id", conditionId)
    .single();

  // If no throttle record, it's eligible (first message)
  if (!throttle) {
    return {
      eligible: true,
      send_count: 0,
    };
  }

  // Check minimum time between sends
  if (throttle.last_sent_at) {
    const lastSent = new Date(throttle.last_sent_at);
    const hoursSinceLastSend =
      (now.getTime() - lastSent.getTime()) / (1000 * 60 * 60);

    if (hoursSinceLastSend < policy.min_hours_between_sends) {
      const nextEligible = new Date(
        lastSent.getTime() + policy.min_hours_between_sends * 60 * 60 * 1000
      );
      return {
        eligible: false,
        reason: `Too soon - minimum ${policy.min_hours_between_sends}h between messages`,
        next_eligible_at: nextEligible.toISOString(),
        send_count: throttle.send_count,
        last_sent_at: throttle.last_sent_at,
      };
    }
  }

  // Check weekly limit
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const { count: weeklySends } = await (sb as any)
    .from("condition_messages")
    .select("*", { count: "exact", head: true })
    .eq("application_id", applicationId)
    .eq("condition_id", conditionId)
    .eq("status", "SENT")
    .gte("sent_at", weekAgo.toISOString());

  if ((weeklySends || 0) >= policy.max_sends_per_week) {
    return {
      eligible: false,
      reason: `Weekly limit reached (${policy.max_sends_per_week} max per week)`,
      send_count: throttle.send_count,
      last_sent_at: throttle.last_sent_at,
    };
  }

  // Check monthly limit
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const { count: monthlySends } = await (sb as any)
    .from("condition_messages")
    .select("*", { count: "exact", head: true })
    .eq("application_id", applicationId)
    .eq("condition_id", conditionId)
    .eq("status", "SENT")
    .gte("sent_at", monthAgo.toISOString());

  if ((monthlySends || 0) >= policy.max_sends_per_month) {
    return {
      eligible: false,
      reason: `Monthly limit reached (${policy.max_sends_per_month} max per month)`,
      send_count: throttle.send_count,
      last_sent_at: throttle.last_sent_at,
    };
  }

  // All checks passed
  return {
    eligible: true,
    send_count: throttle.send_count || 0,
    last_sent_at: throttle.last_sent_at,
  };
}

export async function recordMessageSent(
  applicationId: string,
  conditionId: string,
  messageId: string
): Promise<void> {
  const sb = supabaseAdmin();
  const now = new Date();

  // Upsert throttle record
  await (sb as any).from("condition_message_throttles").upsert(
    {
      application_id: applicationId,
      condition_id: conditionId,
      send_count: (sb as any).raw("COALESCE(send_count, 0) + 1"),
      last_sent_at: now.toISOString(),
      last_message_id: messageId,
      updated_at: now.toISOString(),
    },
    {
      onConflict: "application_id,condition_id",
    }
  );
}
