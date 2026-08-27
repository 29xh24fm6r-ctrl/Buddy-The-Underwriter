import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  PortalLinkError,
  resolveBorrowerToken,
} from "@/lib/portal/resolveBorrowerToken";

export async function GET(_: Request, ctx: { params: Promise<{ token: string }> }) {
  const sb = supabaseAdmin();
  const { token } = await ctx.params;

  let dealId: string;
  try {
    dealId = (await resolveBorrowerToken(token)).deal_id;
  } catch (error) {
    const status = error instanceof PortalLinkError ? error.status : 500;
    return NextResponse.json(
      { error: status === 500 ? "Unable to validate token" : "Invalid token" },
      { status },
    );
  }

  const { data, error } = await sb
    .from("deal_uploads")
    .select("upload_id, checklist_key, doc_type, status, confidence, updated_at, uploads!inner(original_filename, mime_type, bytes, created_at)")
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
