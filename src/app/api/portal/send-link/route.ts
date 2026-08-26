import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { sendSmsWithConsent } from "@/lib/sms/send";
import { upsertBorrowerPhoneLink } from "@/lib/sms/phoneLinks";
import { normalizeE164 } from "@/lib/sms/phone";
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
 * AUTH (SPEC-SEC-PORTAL-LINK-1): Clerk banker on the deal's own bank.
 * Without this check the route is an open SMS relay — it sends
 * caller-supplied text to a caller-supplied number from the platform's
 * Twilio account — as well as a portal-token mint for any deal_id.
 * Middleware does not gate /api/** (see src/proxy.ts), so the check
 * lives here. `message` is only honoured for an authenticated banker on
 * the deal, and is length-capped; the portal URL is always appended so a
 * custom body can never replace the link with an attacker's.
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

    const access = await ensureDealBankAccess(String(deal_id));
    if (!access.ok) {
      return NextResponse.json(
        { error: access.error },
        { status: access.error === "unauthorized" ? 401 : access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    // 1. Create portal link
    const token = randomToken();
    const expiresAt = new Date(Date.now() + expires_hours * 3600 * 1000).toISOString();

    const sb = supabaseAdmin();
    
    // Get deal context for bank_id
    const { data: deal } = await sb
      .from("deals")
      .select("id, bank_id")
      .eq("id", deal_id)
      .single();

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

    // 1b. Create phone link (phone → deal/borrower mapping)
    try {
      await upsertBorrowerPhoneLink({
        phoneE164: normalizeE164(to_phone),
        bankId: deal?.bank_id || null,
        dealId: deal_id,
        source: "portal_link",
        metadata: {
          label,
          token,
          created_via: "send_link_api",
        },
      });
    } catch (phoneLinkErr) {
      console.error("Phone link creation error:", phoneLinkErr);
      // Don't fail the whole request if phone link fails
    }

    // 2. Build portal URL
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const portalUrl = `${appUrl}/upload/${link.token}`;

    // 3. Build message.
    // A banker-supplied note is prepended, never substituted — the portal
    // URL and expiry are always appended so the link in the SMS is the one
    // this route just minted. Capped so a long body can't fan out into
    // many billable segments.
    const MAX_NOTE_CHARS = 300;
    const note =
      typeof message === "string" && message.trim()
        ? `${message.trim().slice(0, MAX_NOTE_CHARS)}\n\n`
        : "";
    const msg = `${note}Buddy upload link: ${portalUrl}\n(Expires in ${expires_hours}h)`;

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
