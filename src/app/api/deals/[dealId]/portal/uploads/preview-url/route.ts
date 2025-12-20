// src/app/api/deals/[dealId]/portal/uploads/preview-url/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns a signed read URL for a borrower upload (banker-side).
 * Security:
 * - verifies upload exists
 * - verifies upload.deal_id === dealId
 * - returns short-lived signed URL (default 10 minutes)
 */
export async function POST(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  const body = await req.json().catch(() => ({}));
  const uploadId = body?.uploadId;
  const expiresIn = Math.max(60, Math.min(60 * 60, Number(body?.expiresIn ?? 600))); // 1m .. 1h, default 10m

  if (!uploadId || typeof uploadId !== "string") {
    return NextResponse.json({ error: "Missing uploadId" }, { status: 400 });
  }

  const { data: upload, error: upErr } = await sb
    .from("borrower_uploads")
    .select("id, deal_id, bank_id, storage_bucket, storage_path, original_filename, mime_type")
    .eq("id", uploadId)
    .single();

  if (upErr || !upload) return NextResponse.json({ error: "Upload not found" }, { status: 404 });
  if (upload.deal_id !== dealId) return NextResponse.json({ error: "Upload not in deal" }, { status: 400 });

  const bucket = upload.storage_bucket || "borrower_uploads";
  const path = upload.storage_path;

  const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, expiresIn);

  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: "Failed to create signed URL" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    signedUrl: data.signedUrl,
    expiresIn,
    filename: upload.original_filename,
    mimeType: upload.mime_type,
  });
}
