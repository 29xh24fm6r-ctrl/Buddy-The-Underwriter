import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/requireRole";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: { dealId: string; attachmentId: string } }) {
  await requireRole(["super_admin", "bank_admin", "underwriter"]);

  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("document_ocr_results")
    .select("attachment_id, extracted_text, created_at, updated_at")
    .eq("deal_id", ctx.params.dealId)
    .eq("attachment_id", ctx.params.attachmentId)
    .maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ ok: false, error: "OCR text not found" }, { status: 404 });

  return NextResponse.json({ ok: true, doc: data });
}
