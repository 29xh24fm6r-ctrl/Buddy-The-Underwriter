import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendSmsWithConsent } from "@/lib/sms/send";
import crypto from "crypto";

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
 * 
 * Now includes STOP/HELP compliance:
 * - Checks opt-out status before sending
 * - Throws if borrower has opted out
 * - Logs to outbound_messages + deal_events
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

    // 4. Send via Twilio with consent enforcement
    try {
      const result = await sendSmsWithConsent({
        dealId: deal_id,
        to: to_phone,
        body: msg,
        label: "Upload link",
        metadata: {
          token: link.token,
          expires_at: expiresAt,
        },
      });

      return NextResponse.json({
        ok: true,
        portal_url: portalUrl,
        sid: result.sid,
        token: link.token,
      });
    } catch (e: any) {
      // Check if opted out
      if (e.code === "SMS_OPTED_OUT") {
        return NextResponse.json(
          {
            ok: false,
            error: "Borrower has opted out of SMS",
            portal_url: portalUrl,
          },
          { status: 403 }
        );
      }

      // Twilio not configured or other error
      console.error("SMS send error:", e);
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
