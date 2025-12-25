import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string; docId: string }> },
) {
  const supabase = supabaseAdmin();

  const { data: doc, error } = await supabase
    .from("generated_documents")
    .select("id, deal_id, pdf_storage_path")
    .eq("id", docId)
    .single();

  if (error || !doc || doc.deal_id !== dealId || !doc.pdf_storage_path) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const bucket = "generated-documents";
  const { data, error: signErr } = await supabase.storage
    .from(bucket)
    .createSignedUrl(doc.pdf_storage_path, 60 * 10); // 10 minutes

  if (signErr || !data?.signedUrl) {
    return NextResponse.json(
      { error: signErr?.message ?? "Sign failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ url: data.signedUrl });
}
