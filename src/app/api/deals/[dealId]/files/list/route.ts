import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: { dealId: string } }) {
  const dealId = params.dealId;

  const { data, error } = await supabaseAdmin()
    .from("deal_documents")
    .select(
      "id, created_at, deal_id, storage_bucket, storage_path, original_filename, mime_type, size_bytes, source, checklist_key"
    )
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Back-compat: return the fields old UI expects from deal_files
  const files = (data ?? []).map((d: any) => ({
    file_id: d.id,
    stored_name: d.storage_path,
    original_name: d.original_filename,
    mime_type: d.mime_type,
    created_at: d.created_at,
    deal_id: d.deal_id,
    storage_bucket: d.storage_bucket,
    storage_path: d.storage_path,
    size_bytes: d.size_bytes,
    source: d.source,
    checklist_key: d.checklist_key,
  }));

  return NextResponse.json({ ok: true, files });
}
