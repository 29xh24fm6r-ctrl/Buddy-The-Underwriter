import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { logPipelineLedger } from "@/lib/pipeline/logPipelineLedger";

export const dynamic = "force-dynamic";

type Body = {
  requestedKeys: string[];
  label?: string;
  expiresHours?: number;
  channels?: { email?: boolean; sms?: boolean };
  borrower?: { name?: string; email?: string; phone?: string };
};

export async function POST(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const sb = supabaseAdmin();
  try {
    const { dealId } = await ctx.params;
    const body = (await req.json()) as Body;
    const requestedKeys = Array.from(new Set((body.requestedKeys || []).filter(Boolean)));
    if (requestedKeys.length === 0) {
      return NextResponse.json({ ok: false, error: "No requestedKeys provided" }, { status: 400 });
    }

    const bankId = await getCurrentBankId();

    // Create a single borrower invite token + reuse for all uploads (deal-scoped)
    const expiresHours = Math.max(1, Math.min(168, body.expiresHours ?? 72));
    const label = body.label ?? "Borrower docs";
    const channelEmail = body.channels?.email ?? true;
    const channelSms = body.channels?.sms ?? false;

    const token = crypto.randomUUID().replaceAll("-", "");
    const expiresAt = new Date(Date.now() + expiresHours * 3600 * 1000).toISOString();

    const borrowerName = body.borrower?.name ?? null;
    const borrowerEmail = body.borrower?.email ?? null;
    const borrowerPhone = body.borrower?.phone ?? null;

    const { error: invErr } = await sb.from("borrower_invites").insert({
      bank_id: bankId,
      deal_id: dealId,
      token,
      label,
      expires_at: expiresAt,
      borrower_name: borrowerName,
      borrower_email: borrowerEmail,
      borrower_phone: borrowerPhone,
    } as any);
    if (invErr) throw invErr;

    // Build links (one per requested key) that deep-link into portal and pre-select key.
    const base = process.env.NEXT_PUBLIC_APP_URL || "";
    const links = requestedKeys.map((k) => ({
      checklist_key: k,
      url: `${base}/portal/${token}?k=${encodeURIComponent(k)}`,
    }));

    // Store request pack (if table exists)
    const packInsert = await sb.from("borrower_request_packs").insert({
      bank_id: bankId,
      deal_id: dealId,
      created_by: null,
      channel_email: channelEmail,
      channel_sms: channelSms,
      borrower_name: borrowerName,
      borrower_email: borrowerEmail,
      borrower_phone: borrowerPhone,
      label,
      expires_hours: expiresHours,
      requested_keys: requestedKeys,
      links_json: links,
      status: "created",
    } as any);
    // Silently ignore if table doesn't exist
    if (packInsert.error) {
      console.warn("[borrower-request] borrower_request_packs insert failed (table may not exist):", packInsert.error.message);
    }

    await logPipelineLedger(sb, {
      bank_id: bankId,
      deal_id: dealId,
      event_type: "borrower_request_pack_created",
      status: "ok",
      payload: { requestedKeys, expiresHours, channels: { email: channelEmail, sms: channelSms } },
    });

    // NOTE: sending email/SMS can be async; for now return links.
    return NextResponse.json({ ok: true, token, expiresAt, links });
  } catch (e: any) {
    try {
      const sb2 = supabaseAdmin();
      // best-effort ledger
      const dealId = (await ctx.params).dealId;
      await sb2.from("deal_pipeline_ledger").insert({
        deal_id: dealId,
        bank_id: null,
        event_type: "borrower_request_pack_created",
        status: "error",
        error: String(e?.message ?? e),
      } as any);
    } catch {}
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
