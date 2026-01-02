import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/deals/:dealId/borrower/inbox/preview
 * Body: { upload_inbox_id: string }
 *
 * Returns a short-lived signed URL to view/download the uploaded file.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  try {
    const body = await req.json().catch(() => ({}));
    const upload_inbox_id = String(body?.upload_inbox_id || "").trim();
    if (!upload_inbox_id) throw new Error("missing_upload_inbox_id");

    // Ensure this upload belongs to the deal (prevents leaking other deals)
    const rowRes = await sb
      .from("borrower_upload_inbox")
      .select("id, deal_id, storage_path")
      .eq("id", upload_inbox_id)
      .single();

    if (rowRes.error) throw new Error(rowRes.error.message);
    if (!rowRes.data) throw new Error("upload_not_found");
    if (rowRes.data.deal_id !== dealId) throw new Error("deal_mismatch");

    const storage_path = rowRes.data.storage_path;
    if (!storage_path) throw new Error("missing_storage_path");

    // Bucket must match your upload route bucket
    const bucket = "borrower-uploads";

    // 5 minute signed URL
    const signed = await sb.storage
      .from(bucket)
      .createSignedUrl(storage_path, 60 * 5);
    if (signed.error) throw new Error(signed.error.message);

    return NextResponse.json({ ok: true, signedUrl: signed.data.signedUrl });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "preview_failed" },
      { status: 400 },
    );
  }
}
