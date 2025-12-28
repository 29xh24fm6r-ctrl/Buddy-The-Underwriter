import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import crypto from "crypto";
import Twilio from "twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function randomToken() {
  return crypto.randomBytes(24).toString("base64url");
}

/**
 * POST /api/portal/send-link
 * 
 * Banker sends portal link via SMS (Twilio)
 * Body: { deal_id, to_phone, label?, expires_hours?, single_use?, message? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      deal_id,
      to_phone,
      label = "Borrower docs",
      expires_hours = 72,
      single_use = true,
      message = null,
    } = body;

    if (!deal_id || !to_phone) {
      return NextResponse.json(
        { error: "deal_id and to_phone required" },
        { status: 400 }
      );
    }

    // 1. Create portal link
    const token = randomToken();
    const expiresAt = new Date(Date.now() + expires_hours * 3600 * 1000).toISOString();

    const sb = supabaseAdmin();
    const { data: link, error: linkErr } = await sb
      .from("borrower_portal_links")
      .insert({
        deal_id,
        token,
        label,
        single_use,
        expires_at: expiresAt,
        channel: "sms",
      })
      .select("token, deal_id, expires_at")
      .single();

    if (linkErr) {
      console.error("Link creation error:", linkErr);
      return NextResponse.json({ error: linkErr.message }, { status: 400 });
    }

    // 2. Build portal URL
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const portalUrl = `${appUrl}/upload/${link.token}`;

    // 3. Build message
    const msg =
      message ||
      `Buddy upload link: ${portalUrl}\n(Expires in ${expires_hours}h)`;

    // 4. Send via Twilio
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM_NUMBER;

    if (!accountSid || !authToken || !from) {
      // Graceful degradation: no Twilio configured
      await sb.from("outbound_messages").insert({
        deal_id,
        channel: "sms",
        to_value: to_phone,
        body: msg,
        status: "failed",
        provider: "twilio",
        error: "Twilio not configured",
      });

      return NextResponse.json({
        ok: false,
        error: "Twilio not configured (TWILIO_ACCOUNT_SID missing)",
        portal_url: portalUrl,
      });
    }

    try {
      const twilio = Twilio(accountSid, authToken);
      const res = await twilio.messages.create({
        to: to_phone,
        from,
        body: msg,
      });

      // Log success
      await sb.from("outbound_messages").insert({
        deal_id,
        channel: "sms",
        to_value: to_phone,
        body: msg,
        status: "sent",
        provider: "twilio",
        provider_message_id: res.sid,
        sent_at: new Date().toISOString(),
      });

      return NextResponse.json({
        ok: true,
        portal_url: portalUrl,
        sid: res.sid,
        token: link.token,
      });
    } catch (e: any) {
      console.error("Twilio send error:", e);

      // Log failure
      await sb.from("outbound_messages").insert({
        deal_id,
        channel: "sms",
        to_value: to_phone,
        body: msg,
        status: "failed",
        provider: "twilio",
        error: String(e?.message ?? e),
      });

      return NextResponse.json(
        {
          ok: false,
          error: String(e?.message ?? e),
          portal_url: portalUrl,
        },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error("Send link error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to send link" },
      { status: 500 }
    );
  }
}
