import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { dealId } = await ctx.params;

  const { data, error } = await supabaseAdmin()
    .from("deal_upload_audit")
    .select(
      "id, deal_id, uploaded_at, uploader_type, uploader_display_name, uploader_email, storage_bucket, storage_path, original_filename, mime_type, size_bytes, checklist_key, uploaded_via_link_id"
    )
    .eq("deal_id", dealId)
    .order("uploaded_at", { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, rows: data ?? [] });
}
