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

  // Look up the deal_id from the outbound_messages row created by the
  // outbound send so we can attach the status to a real deal — deal_events
  // requires deal_id NOT NULL. Schema columns are (deal_id, kind, payload).
  const { data: outbound } = await sb
    .from("outbound_messages")
    .select("deal_id")
    .eq("provider_message_id", messageSid)
    .maybeSingle();

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

    if (error) {
      console.error("deal_events insert sms_status failed:", error);
    }
  } else {
    console.warn(
      "[twilio/status] no deal_id resolved for messageSid — skipping deal_events insert",
      { messageSid, messageStatus },
    );
  }

  return NextResponse.json({ ok: true });
}
