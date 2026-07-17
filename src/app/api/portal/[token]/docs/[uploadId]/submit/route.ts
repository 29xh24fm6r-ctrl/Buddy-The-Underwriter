import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveBorrowerToken } from "@/lib/portal/resolveBorrowerToken";

export async function POST(req: Request, ctx: { params: Promise<{ token: string; uploadId: string }> }) {
  const sb = supabaseAdmin();
  const { token, uploadId } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  // Only ever checked borrower_portal_links — see fields/route.ts for the
  // same fallback gap.
  const { data: link, error: linkErr } = await sb
    .from("borrower_portal_links")
    .select("deal_id")
    .eq("token", token)
    .maybeSingle();

  if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 });

  let dealId = link?.deal_id ?? null;
  if (!link) {
    try {
      dealId = (await resolveBorrowerToken(token)).deal_id;
    } catch {
      return NextResponse.json({ error: "Invalid token" }, { status: 404 });
    }
  }

  // Enforce: no remaining needs_attention fields
  const { data: pending, error: pendErr } = await sb
    .from("doc_fields")
    .select("id")
    .eq("deal_id", dealId)
    .eq("upload_id", uploadId)
    .eq("needs_attention", true)
    .limit(1);

  if (pendErr) return NextResponse.json({ error: pendErr.message }, { status: 500 });
  if (pending && pending.length > 0) {
    return NextResponse.json({ error: "Fields still need attention" }, { status: 409 });
  }

  // Idempotency: if already submitted, return ok
  const { data: existing } = await sb
    .from("doc_submissions")
    .select("id")
    .eq("deal_id", dealId)
    .eq("upload_id", uploadId)
    .eq("token", token)
    .maybeSingle();

  if (existing?.id) return NextResponse.json({ ok: true, already: true });

  const { error } = await sb
    .from("doc_submissions")
    .insert({
      deal_id: dealId,
      upload_id: uploadId,
      token,
      status: "submitted",
      notes: body?.notes ?? null,
    });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // DB trigger emits deal_event('doc_confirmed') + marks checklist received automatically.

  // Additionally: emit a pipeline "kick" event (idempotent)
  await sb.from("deal_events").insert({
    deal_id: dealId,
    kind: "pipeline_kick",
    payload: { reason: "borrower_submit", upload_id: uploadId },
  });

  return NextResponse.json({ ok: true });
}
