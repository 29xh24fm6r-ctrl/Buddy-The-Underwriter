import { supabaseAdmin } from "@/lib/supabase/admin";

export type OutboundChannel = "email" | "sms";

export type OutboundMessage = {
  dealId: string;
  channel: OutboundChannel;
  to: string;
  subject?: string; // email only
  body: string;
  meta?: Record<string, unknown>;
};

export type OutboundResult = {
  ok: boolean;
  id?: string;
  error?: string;
};

/**
 * Canonical outbound orchestrator.
 * This module is intentionally "boring" and strongly typed.
 * Extend by adding real provider senders (SendGrid/Twilio/etc).
 */
export async function sendOutbound(
  msg: OutboundMessage,
  opts?: { dryRun?: boolean }
): Promise<OutboundResult> {
  const dryRun = Boolean(opts?.dryRun);

  // Persist an event row if your schema includes it.
  // If the table doesn't exist yet, this will fail — so we guard.
  // (Keeps build bulletproof across DB states.)
  try {
    const sb = supabaseAdmin();

    // If you have a canonical outbound events table, write to it here.
    // For now, we write into deal_reminder_events if it exists (optional).
    const maybe = await sb
      .from("deal_reminder_events")
      .insert({
        deal_id: msg.dealId,
        channel: msg.channel,
        destination: msg.to,
        missing_keys: [],
        status: dryRun ? "queued" : "queued",
        error: null,
      })
      .select("id")
      .maybeSingle();

    const eventId = maybe.data?.id as string | undefined;

    if (dryRun) {
      return { ok: true, id: eventId };
    }

    // Wire real providers
    let sendSuccess = false;
    let sendError = null;

    try {
      if (msg.channel === "email") {
        const { getEmailProvider } = await import("@/lib/email/getProvider");
        const provider = getEmailProvider();
        const from = process.env.EMAIL_FROM || "noreply@buddy.com";
        await provider.send({
          to: msg.to,
          from,
          subject: msg.subject || "Notification",
          text: msg.body,
        });
        sendSuccess = true;
      } else if (msg.channel === "sms") {
        // SMS via Twilio - implement when ready
        sendError = "SMS provider not configured";
      }
    } catch (e: any) {
      sendError = e.message;
    }

    // Update event status
    if (eventId) {
      await sb
        .from("deal_reminder_events")
        .update({ 
          status: sendSuccess ? "sent" : "failed",
          error: sendError,
        })
        .eq("id", eventId);
    }

    return sendSuccess 
      ? { ok: true, id: eventId }
      : { ok: false, error: sendError || "Send failed", id: eventId };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Outbound send failed." };
  }
}

/**
 * Convenience: send many messages
 */
export async function sendOutboundBatch(
  messages: OutboundMessage[],
  opts?: { dryRun?: boolean }
): Promise<OutboundResult[]> {
  const out: OutboundResult[] = [];
  for (const m of messages) {
    out.push(await sendOutbound(m, opts));
  }
  return out;
}
