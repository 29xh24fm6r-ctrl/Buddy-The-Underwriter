import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

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
 */
export async function POST(req: Request) {
  const form = await req.formData();

  const messageSid = String(form.get("MessageSid") || "");
  const messageStatus = String(form.get("MessageStatus") || "");
  const to = String(form.get("To") || "");
  const errorCode = form.get("ErrorCode") ? String(form.get("ErrorCode")) : null;
  const errorMessage = form.get("ErrorMessage") ? String(form.get("ErrorMessage")) : null;

  const sb = supabaseAdmin();

  const { error } = await sb.from("deal_events").insert({
    deal_id: null, // TODO: backfill by matching sid to outbound_messages
    kind: "sms_status",
    metadata: {
      messageSid,
      messageStatus,
      to,
      errorCode,
      errorMessage,
    },
  });

  if (error) {
    console.error("deal_events insert sms_status failed:", error);
  }

  return NextResponse.json({ ok: true });
}
