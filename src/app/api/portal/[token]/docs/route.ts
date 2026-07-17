import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveBorrowerToken } from "@/lib/portal/resolveBorrowerToken";

export async function GET(_: Request, ctx: { params: Promise<{ token: string }> }) {
  const sb = supabaseAdmin();
  const { token } = await ctx.params;

  const { data: link, error: linkErr } = await sb
    .from("borrower_portal_links")
    .select("deal_id, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 });

  // Fall back to a borrower_invites token so the invite flow lists docs too.
  let dealId: string | null = link?.deal_id ?? null;
  if (!link) {
    try {
      dealId = (await resolveBorrowerToken(token)).deal_id;
    } catch {
      return NextResponse.json({ error: "Invalid token" }, { status: 404 });
    }
  } else if (link.expires_at && new Date(link.expires_at) < new Date()) {
    // Previously never checked — an expired SMS/upload link kept listing
    // documents forever, unlike the sibling checklist route.
    return NextResponse.json({ error: "Link expired" }, { status: 403 });
  }

  const { data, error } = await sb
    .from("deal_uploads")
    .select("upload_id, checklist_key, doc_type, status, confidence, updated_at, uploads!inner(original_filename, mime_type, bytes, storage_bucket, storage_path, created_at)")
    .eq("deal_id", dealId)
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const docs = (data ?? []).map((r: any) => ({
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
  }));

  // Phase 85A.3 — add ok + count additively for the intake form's client fetch.
  // Existing consumers reading { deal_id, docs } remain unchanged.
  return NextResponse.json({
    ok: true,
    deal_id: dealId,
    count: docs.length,
    docs,
  });
}
