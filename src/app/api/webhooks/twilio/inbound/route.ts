import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  normalizeInboundBody,
  isStop,
  isHelp,
  isStart,
  twiml,
  stopReply,
  helpReply,
  startReply,
} from "@/lib/sms/compliance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/twilio/inbound
 * 
 * Twilio webhook for inbound SMS
 * Handles STOP/HELP/START keywords + logs all messages
 * 
 * Set in Twilio Console:
 * Messaging Service → Inbound Settings → Request URL
 * https://yourapp.com/api/webhooks/twilio/inbound
 */
export async function POST(req: Request) {
  const form = await req.formData();

  const from = String(form.get("From") || "");
  const to = String(form.get("To") || "");
  const bodyRaw = String(form.get("Body") || "");
  const bodyNorm = normalizeInboundBody(bodyRaw);

  const messageSid = String(form.get("MessageSid") || "");
  const serviceSid = String(form.get("MessagingServiceSid") || "");

  const sb = supabaseAdmin();

  // 1. Always log inbound message to deal_events
  const { error: inboundErr } = await sb.from("deal_events").insert({
    deal_id: null, // TODO: resolve deal by phone number lookup
    kind: "sms_inbound",
    metadata: {
      from,
      to,
      body: bodyRaw,
      body_norm: bodyNorm,
      messageSid,
      messagingServiceSid: serviceSid,
    },
  });

  if (inboundErr) {
    console.error("deal_events insert sms_inbound failed:", inboundErr);
  }

  // 2. STOP handling (opt-out)
  if (isStop(bodyNorm)) {
    const { error: optOutErr } = await sb.from("deal_events").insert({
      deal_id: null,
      kind: "sms_opt_out",
      metadata: {
        phone: from,
        from,
        reason: bodyNorm,
        messageSid,
      },
    });

    if (optOutErr) {
      console.error("deal_events insert sms_opt_out failed:", optOutErr);
    }

    return new NextResponse(twiml(stopReply()), {
      headers: { "Content-Type": "text/xml" },
    });
  }

  // 3. START handling (opt-in / resubscribe)
  if (isStart(bodyNorm)) {
    const { error: optInErr } = await sb.from("deal_events").insert({
      deal_id: null,
      kind: "sms_opt_in",
      metadata: {
        phone: from,
        from,
        reason: bodyNorm,
        messageSid,
      },
    });

    if (optInErr) {
      console.error("deal_events insert sms_opt_in failed:", optInErr);
    }

    return new NextResponse(twiml(startReply()), {
      headers: { "Content-Type": "text/xml" },
    });
  }

  // 4. HELP handling
  if (isHelp(bodyNorm)) {
    const { error: helpErr } = await sb.from("deal_events").insert({
      deal_id: null,
      kind: "sms_help",
      metadata: {
        phone: from,
        from,
        messageSid,
      },
    });

    if (helpErr) {
      console.error("deal_events insert sms_help failed:", helpErr);
    }

    return new NextResponse(twiml(helpReply()), {
      headers: { "Content-Type": "text/xml" },
    });
  }

  // 5. Default: no auto-reply (keeps UX clean, borrower messages go to timeline)
  return new NextResponse(twiml(), {
    headers: { "Content-Type": "text/xml" },
  });
}
