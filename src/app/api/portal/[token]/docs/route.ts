import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET(_: Request, ctx: { params: Promise<{ token: string }> }) {
  const sb = supabaseAdmin();
  const { token } = await ctx.params;

  const { data: link, error: linkErr } = await sb
    .from("borrower_portal_links")
    .select("deal_id, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 });
  if (!link) return NextResponse.json({ error: "Invalid token" }, { status: 404 });

  const { data, error } = await sb
    .from("deal_uploads")
    .select("upload_id, checklist_key, doc_type, status, confidence, updated_at, uploads!inner(original_filename, mime_type, bytes, storage_bucket, storage_path, created_at)")
    .eq("deal_id", link.deal_id)
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    deal_id: link.deal_id,
    docs: (data ?? []).map((r: any) => ({
      upload_id: r.upload_id,
      filename: r.uploads.original_filename,
      mime_type: r.uploads.mime_type,
      bytes: r.uploads.bytes,
      checklist_key: r.checklist_key,
      doc_type: r.doc_type,
      status: r.status,
      confidence: r.confidence,
      storage: {
        bucket: r.uploads.storage_bucket,
        path: r.uploads.storage_path,
      },
      updated_at: r.updated_at,
      created_at: r.uploads.created_at,
    })),
  });
}
