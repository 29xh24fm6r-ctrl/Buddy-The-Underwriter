import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string; attachmentId: string }> },
) {
  await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);

  const { dealId, attachmentId } = await ctx.params;
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("document_ocr_results")
    .select("attachment_id, extracted_text, created_at, updated_at")
    .eq("deal_id", dealId)
    .eq("attachment_id", attachmentId)
    .maybeSingle();

  if (error)
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  if (!data)
    return NextResponse.json(
      { ok: false, error: "OCR text not found" },
      { status: 404 },
    );

  return NextResponse.json({ ok: true, doc: data });
}
