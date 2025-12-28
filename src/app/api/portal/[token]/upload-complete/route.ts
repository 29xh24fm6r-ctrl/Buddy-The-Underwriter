import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const sb = supabaseAdmin();
  const { token } = await ctx.params;
  const body = await req.json().catch(() => null);

  if (!body?.bucket || !body?.path || !body?.original_filename) {
    return NextResponse.json({ error: "bucket, path, original_filename required" }, { status: 400 });
  }

  const { data: link } = await sb.from("borrower_portal_links").select("deal_id").eq("token", token).maybeSingle();
  if (!link) return NextResponse.json({ error: "Invalid token" }, { status: 404 });

  const { data: uploadRow, error: upErr } = await sb
    .from("uploads")
    .insert({
      original_filename: body.original_filename,
      mime_type: body.mime_type ?? null,
      bytes: body.bytes ?? null,
      storage_bucket: body.bucket,
      storage_path: body.path,
      created_by: `borrower:${token}`,
      sha256: body.sha256 ?? null,
    })
    .select("id")
    .single();

  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

  const { error: duErr } = await sb
    .from("deal_uploads")
    .insert({
      deal_id: link.deal_id,
      upload_id: uploadRow.id,
      checklist_key: body.checklist_key ?? null,
      doc_type: body.doc_type ?? null,
      status: "uploaded",
      confidence: null,
    });

  if (duErr) return NextResponse.json({ error: duErr.message }, { status: 500 });

  await sb.from("deal_events").insert({
    deal_id: link.deal_id,
    kind: "upload_received",
    payload: { upload_id: uploadRow.id, filename: body.original_filename },
  });

  return NextResponse.json({ ok: true, upload_id: uploadRow.id, deal_id: link.deal_id });
}
