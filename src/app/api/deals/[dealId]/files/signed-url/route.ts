import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  const body = await req.json().catch(() => ({}) as any);

  const storedName = String(body?.stored_name || body?.storage_path || "");
  const bucket = String(body?.storage_bucket || "deal-uploads");

  if (!storedName) {
    return NextResponse.json(
      { ok: false, error: "Missing stored_name (storage path)." },
      { status: 400 },
    );
  }

  // Optional safety: ensure the path belongs to this deal (prevents guessing other deals)
  // We verify the document exists for this deal + path.
  const { data: doc, error: docErr } = await supabaseAdmin()
    .from("deal_documents")
    .select("id, storage_bucket, storage_path")
    .eq("deal_id", dealId)
    .eq("storage_path", storedName)
    .maybeSingle();

  if (docErr) {
    return NextResponse.json(
      { ok: false, error: docErr.message },
      { status: 500 },
    );
  }
  if (!doc) {
    return NextResponse.json(
      { ok: false, error: "File not found for this deal." },
      { status: 404 },
    );
  }

  const useBucket = String(doc.storage_bucket || bucket);
  const usePath = String(doc.storage_path);

  const { data, error } = await supabaseAdmin()
    .storage.from(useBucket)
    .createSignedUrl(usePath, 60 * 10); // 10 minutes

  if (error || !data?.signedUrl) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to create signed URL." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, signedUrl: data.signedUrl });
}
