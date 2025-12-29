import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await ctx.params;
    const { data, error } = await supabaseAdmin()
      .rpc("list_deal_documents", { p_deal_id: dealId });

    if (error) {
      console.error("[/api/deals/[dealId]/files/list]", error.message, {
        details: error.details,
        hint: error.hint,
      });
      return NextResponse.json({
        ok: false,
        files: [],
        error: "Failed to load files",
      });
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
  } catch (error: any) {
    console.error("[/api/deals/[dealId]/files/list]", error);
    return NextResponse.json({
      ok: false,
      files: [],
      error: "Failed to load files",
    });
  }
}
