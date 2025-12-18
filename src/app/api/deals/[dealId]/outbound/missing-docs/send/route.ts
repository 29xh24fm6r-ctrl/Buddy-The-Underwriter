import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getEmailProvider } from "@/lib/email/getProvider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function nowIso() {
  return new Date().toISOString();
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const parts = url.pathname.split("/");
  const dealId = parts[parts.indexOf("deals") + 1];

  const sb = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  // settings
  const { data: settings } = await sb
    .from("deal_outbound_settings")
    .select("mode,to_email,from_email")
    .eq("deal_id", dealId)
    .maybeSingle();

  const mode = (settings as any)?.mode ?? "copy";
  const toEmail = (settings as any)?.to_email ?? null;
  const fromEmail = (settings as any)?.from_email ?? process.env.OUTBOUND_FROM_EMAIL ?? null;

  if (mode !== "system") {
    return NextResponse.json({ ok: false, error: "mode_is_copy" }, { status: 400 });
  }
  if (!toEmail) return NextResponse.json({ ok: false, error: "missing_to_email" }, { status: 400 });
  if (!fromEmail) return NextResponse.json({ ok: false, error: "missing_from_email" }, { status: 400 });

  // Load the current pending draft
  const { data: drafts, error: dErr } = await sb
    .from("deal_message_drafts")
    .select("id,subject,body,fingerprint,status")
    .eq("deal_id", dealId)
    .eq("kind", "MISSING_DOCS_REQUEST")
    .in("status", ["draft", "pending_approval"])
    .order("updated_at", { ascending: false })
    .limit(1);

  if (dErr) return NextResponse.json({ ok: false, error: dErr.message }, { status: 500 });
  if (!drafts || drafts.length === 0) {
    return NextResponse.json({ ok: false, error: "no_pending_draft" }, { status: 404 });
  }

  const draft = drafts[0] as any;

  // Send
  const provider = getEmailProvider();
  try {
    const sent = await provider.send({
      to: toEmail,
      from: fromEmail,
      subject: draft.subject ?? "(no subject)",
      text: draft.body ?? "",
    });

    // ledger
    await sb.from("deal_outbound_ledger").insert({
      deal_id: dealId,
      kind: "MISSING_DOCS_REQUEST",
      fingerprint: draft.fingerprint ?? "missing",
      to_email: toEmail,
      subject: draft.subject ?? "(no subject)",
      provider: sent.provider,
      provider_message_id: sent.provider_message_id,
      status: "sent",
    } as any);

    // mark draft sent
    await sb
      .from("deal_message_drafts")
      .update({ status: "sent", updated_at: nowIso() } as any)
      .eq("id", draft.id);

    return NextResponse.json({ ok: true, dealId, sent });
  } catch (e: any) {
    await sb.from("deal_outbound_ledger").insert({
      deal_id: dealId,
      kind: "MISSING_DOCS_REQUEST",
      fingerprint: draft.fingerprint ?? "missing",
      to_email: toEmail,
      subject: draft.subject ?? "(no subject)",
      provider: "provider",
      provider_message_id: null,
      status: "failed",
      error: String(e?.message ?? e),
    } as any);

    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
