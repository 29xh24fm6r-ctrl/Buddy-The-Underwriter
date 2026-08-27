import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { computeWebhookUrl, verifyTwilioSignature } from "@/lib/sms/twilioVerify";
import { requireTwilioWebhookPersistence } from "@/lib/sms/twilioWebhookPersistence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/twilio/status
 * 
 * Twilio webhook for SMS delivery status callbacks
 * Logs delivery status updates to deal_events
 * 
 * Set in Twilio Console:
 * Messaging Service → Advanced Settings → Status Callback URL
 * https://yourapp.com/api/webhooks/twilio/status
 *
 * SPEC-SEC-API-AUTH-1: verifies the X-Twilio-Signature exactly as the sibling
 * inbound webhook does. Without it this endpoint accepted anonymous form posts
 * and wrote attacker-chosen sms_status rows into deal_events for any
 * MessageSid the caller could guess or observe.
 */
export async function POST(req: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.error("[twilio/status] TWILIO_AUTH_TOKEN not set");
    return new NextResponse("Server configuration error", { status: 500 });
  }

  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    params[k] = String(v);
  }

  // Same posture as the inbound webhook: hard-fail in production, warn in dev
  // when PUBLIC_BASE_URL is unset (the URL is part of the signed payload).
  try {
    const isValid = verifyTwilioSignature({
      url: computeWebhookUrl(new URL(req.url).pathname),
      authToken,
      signature: req.headers.get("x-twilio-signature"),
      params,
    });
    if (!isValid) {
      console.error("[twilio/status] invalid Twilio signature");
      return new NextResponse("Invalid signature", { status: 401 });
    }
  } catch (err) {
    if (process.env.VERCEL) {
      console.error("[twilio/status] PUBLIC_BASE_URL not set in production", err);
      return new NextResponse("Server configuration error", { status: 500 });
    }
    console.warn("[twilio/status] skipping signature verification (PUBLIC_BASE_URL unset in dev)");
  }

  const messageSid = params.MessageSid || "";
  const messageStatus = params.MessageStatus || "";
  const to = params.To || "";
  const errorCode = params.ErrorCode || null;
  const errorMessage = params.ErrorMessage || null;

  const sb = supabaseAdmin();

  // Look up the deal_id from the outbound_messages row created by the
  // outbound send so we can attach the status to a real deal — deal_events
  // requires deal_id NOT NULL. Schema columns are (deal_id, kind, payload).
  const { data: outbound, error: outboundLookupError } = await sb
    .from("outbound_messages")
    .select("deal_id")
    .eq("provider_message_id", messageSid)
    .maybeSingle();

  requireTwilioWebhookPersistence(outboundLookupError, "resolve outbound message");

  const dealId = (outbound as { deal_id: string | null } | null)?.deal_id ?? null;

  if (dealId) {
    const { error } = await sb.from("deal_events").insert({
      deal_id: dealId,
      kind: "sms_status",
      payload: {
        messageSid,
        messageStatus,
        to,
        errorCode,
        errorMessage,
      },
    });

    requireTwilioWebhookPersistence(error, "persist delivery status");
  } else {
    console.warn(
      "[twilio/status] no deal_id resolved for messageSid — skipping deal_events insert",
      { messageSid, messageStatus },
    );
  }

  return NextResponse.json({ ok: true });
}
