import "server-only";
import { assertSmsAllowed } from "@/lib/sms/consent";
import { supabaseAdmin } from "@/lib/supabase/admin";
import Twilio from "twilio";

/**
 * Send SMS with opt-out enforcement and automatic ledger logging
 * 
 * This is the ONLY function that should send SMS in Buddy.
 * All banker sends + reminders should use this.
 * 
 * Features:
 * - Checks opt-out status before sending
 * - Logs to outbound_messages table
 * - Logs to deal_events (if deal_id provided)
 * - Throws if opted out
 */
export async function sendSmsWithConsent(args: {
  dealId?: string | null;
  to: string;
  body: string;
  label?: string;
  metadata?: Record<string, any>;
}): Promise<{ sid: string; status: string }> {
  const { dealId, to, body, label = "SMS", metadata = {} } = args;

  // 1. Enforce opt-out
  await assertSmsAllowed(to);

  // 2. Send via Twilio
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !from) {
    throw new Error("Twilio not configured (missing TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, or TWILIO_FROM_NUMBER)");
  }

  const twilio = Twilio(accountSid, authToken);
  const message = await twilio.messages.create({
    to,
    from,
    body,
  });

  const sb = supabaseAdmin();

  // 3. Log to outbound_messages
  const { error: outboundErr } = await sb.from("outbound_messages").insert({
    deal_id: dealId ?? null,
    channel: "sms",
    to_value: to,
    body,
    status: "sent",
    provider: "twilio",
    provider_message_id: message.sid,
    sent_at: new Date().toISOString(),
  });

  if (outboundErr) {
    console.error("outbound_messages insert error:", outboundErr);
  }

  // 4. Log to deal_events (if deal_id provided)
  if (dealId) {
    const { error: eventErr } = await sb.from("deal_events").insert({
      deal_id: dealId,
      kind: "sms_outbound",
      metadata: {
        to,
        body,
        label,
        sid: message.sid,
        status: message.status,
        ...metadata,
      },
    });

    if (eventErr) {
      console.error("deal_events insert error:", eventErr);
    }
  }

  return {
    sid: message.sid,
    status: message.status,
  };
}
