import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const dynamic = "force-dynamic";

async function maybeSendTwilioSMS(to: string, body: string) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!sid || !token || !from) return { sent: false, reason: "twilio_not_configured" };

  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ From: from, To: to, Body: body }).toString(),
  });
  if (!res.ok) return { sent: false, reason: `twilio_${res.status}` };
  return { sent: true };
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await ctx.params;
  const bankId = await getCurrentBankId().catch(() => null);
  const sb = supabaseAdmin();

  const body = await req.json().catch(() => ({}));
  const to = typeof body.to === "string" ? body.to : null;
  const message =
    typeof body.message === "string"
      ? body.message
      : "Quick reminder: we’re still missing a couple documents to move your loan forward. Upload when you can — thank you!";

  try {
    const { data: deal } = await sb
      .from("deals")
      .select("id, bank_id")
      .eq("id", dealId)
      .maybeSingle();
    if (!deal || (bankId && deal.bank_id !== bankId)) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ ok: false, error: "deal_lookup_failed" }, { status: 500 });
  }

  try {
    await sb.from("deal_pipeline_ledger").insert({
      bank_id: bankId,
      deal_id: dealId,
      event_type: "borrower.nudge.requested",
      status: "info",
      message,
      meta: { to: to ?? undefined },
    } as any);
  } catch {
    // ignore
  }

  if (!to) {
    return NextResponse.json({ ok: true, sent: false, reason: "missing_to_phone" });
  }

  const out = await maybeSendTwilioSMS(to, message).catch((e) => ({
    sent: false,
    reason: String(e?.message ?? e),
  }));

  try {
    await sb.from("deal_pipeline_ledger").insert({
      bank_id: bankId,
      deal_id: dealId,
      event_type: out.sent ? "borrower.nudge.sent" : "borrower.nudge.failed",
      status: out.sent ? "ok" : "warn",
      message,
      meta: { to, reason: (out as any).reason },
    } as any);
  } catch {
    // ignore
  }

  return NextResponse.json({ ok: true, ...out });
}
