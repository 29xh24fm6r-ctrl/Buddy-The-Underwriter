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
import { resolveDealByPhone } from "@/lib/sms/resolve";
import { resolveByPhone, upsertBorrowerPhoneLink } from "@/lib/sms/phoneLinks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/twilio/inbound
 * 
 * Twilio webhook for inbound SMS
 * Handles STOP/HELP/START keywords + logs all messages
 * Phone→deal resolution: automatically attaches to active deal
 * Phone link creation: creates borrower_phone_links entry on first contact
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

  // Resolve phone to deal context (dual strategy: new phone_links + legacy deals.borrower_phone)
  let dealContext = await resolveDealByPhone(from); // Legacy resolver (uses deals.borrower_phone)
  
  // Also check borrower_phone_links table
  const phoneLinkContext = await resolveByPhone(from);
  
  // Prefer phone_links result if available (more specific)
  if (phoneLinkContext?.deal_id && !dealContext) {
    dealContext = {
      deal_id: phoneLinkContext.deal_id,
      bank_id: phoneLinkContext.bank_id || "",
      deal_name: null,
    };
  }
  
  const deal_id = dealContext?.deal_id || null;
  const bank_id = dealContext?.bank_id || null;

  // Create/update phone link on inbound SMS (auto-discovery)
  if (deal_id) {
    try {
      await upsertBorrowerPhoneLink({
        phoneE164: from,
        bankId: bank_id,
        dealId: deal_id,
        borrowerApplicantId: phoneLinkContext?.borrower_applicant_id || null,
        source: "sms_inbound",
        metadata: {
          first_message: bodyRaw.substring(0, 100),
          messageSid,
        },
      });
    } catch (phoneLinkErr) {
      console.error("Phone link auto-creation error:", phoneLinkErr);
      // Don't fail webhook
    }
  }

  // 1. Always log inbound message to deal_events (with resolved deal context)
  const { error: inboundErr } = await sb.from("deal_events").insert({
    deal_id,
    bank_id,
    kind: "sms_inbound",
    description: dealContext
      ? `SMS from borrower (${dealContext.deal_name || "Unknown"}): ${bodyRaw.substring(0, 100)}`
      : `SMS received (no deal match): ${bodyRaw.substring(0, 100)}`,
    metadata: {
      from,
      to,
      body: bodyRaw,
      body_norm: bodyNorm,
      messageSid,
      messagingServiceSid: serviceSid,
      resolved_deal: dealContext
        ? {
            deal_id: dealContext.deal_id,
            deal_name: dealContext.deal_name,
            bank_id: dealContext.bank_id,
          }
        : null,
    },
  });

  if (inboundErr) {
    console.error("deal_events insert sms_inbound failed:", inboundErr);
  }

  // 2. STOP handling (opt-out)
  if (isStop(bodyNorm)) {
    const { error: optOutErr } = await sb.from("deal_events").insert({
      deal_id,
      bank_id,
      kind: "sms_opt_out",
      description: dealContext
        ? `Borrower opted out (${dealContext.deal_name})`
        : "Borrower opted out (no deal match)",
      metadata: {
        phone: from,
        from,
        reason: bodyNorm,
        messageSid,
        resolved_deal: dealContext
          ? {
              deal_id: dealContext.deal_id,
              deal_name: dealContext.deal_name,
            }
          : null,
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
      deal_id,
      bank_id,
      kind: "sms_opt_in",
      description: dealContext
        ? `Borrower opted in (${dealContext.deal_name})`
        : "Borrower opted in (no deal match)",
      metadata: {
        phone: from,
        from,
        reason: bodyNorm,
        messageSid,
        resolved_deal: dealContext
          ? {
              deal_id: dealContext.deal_id,
              deal_name: dealContext.deal_name,
            }
          : null,
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
      deal_id,
      bank_id,
      kind: "sms_help",
      description: dealContext
        ? `Help request from borrower (${dealContext.deal_name})`
        : "Help request (no deal match)",
      metadata: {
        phone: from,
        from,
        messageSid,
        resolved_deal: dealContext
          ? {
              deal_id: dealContext.deal_id,
              deal_name: dealContext.deal_name,
            }
          : null,
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
