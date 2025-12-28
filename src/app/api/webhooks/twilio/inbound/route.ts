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
import { computeWebhookUrl, verifyTwilioSignature } from "@/lib/sms/twilioVerify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/twilio/inbound
 * 
 * Twilio webhook for inbound SMS
 * 
 * Features:
 * - Twilio signature verification (prevents spoofing)
 * - STOP/HELP/START keyword handling (carrier compliance)
 * - Phone→deal resolution (dual strategy)
 * - Auto-creates borrower_phone_links on first contact
 * - Logs to deal_events for timeline
 * 
 * Set in Twilio Console:
 * Messaging Service → Inbound Settings → Request URL
 * https://buddy-the-underwriter.vercel.app/api/webhooks/twilio/inbound
 */
export async function POST(req: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.error("TWILIO_AUTH_TOKEN not set");
    return new NextResponse("Server configuration error", { status: 500 });
  }

  // Parse Twilio form data
  const form = await req.formData();
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    params[k] = String(v);
  }

  const from = params.From || "";
  const to = params.To || "";
  const bodyRaw = params.Body || "";
  const bodyNorm = normalizeInboundBody(bodyRaw);
  const messageSid = params.MessageSid || "";
  const serviceSid = params.MessagingServiceSid || "";

  // Verify Twilio signature (prevents webhook spoofing)
  const signature = req.headers.get("x-twilio-signature");
  const pathname = new URL(req.url).pathname;
  
  try {
    const webhookUrl = computeWebhookUrl(pathname);
    const isValid = verifyTwilioSignature({
      url: webhookUrl,
      authToken,
      signature,
      params,
    });

    if (!isValid) {
      console.error("Invalid Twilio signature", {
        url: webhookUrl,
        signature,
        from,
      });
      return new NextResponse("Invalid signature", { status: 401 });
    }
  } catch (err) {
    // PUBLIC_BASE_URL not set - allow in dev, warn in production
    if (process.env.VERCEL) {
      console.error("PUBLIC_BASE_URL not set in production", err);
      return new NextResponse("Server configuration error", { status: 500 });
    } else {
      console.warn("Skipping signature verification (PUBLIC_BASE_URL not set in dev)");
    }
  }

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
