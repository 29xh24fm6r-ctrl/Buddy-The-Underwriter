import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { assertDealAccess } from "@/lib/server/deal-access";
import { accessErrorToResponse } from "@/lib/server/withDealAccess";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string; documentId: string }> },
) {

  const { dealId, documentId } = await ctx.params;
  try {
    await assertDealAccess(dealId);
  } catch (err) {
    const accessRes = accessErrorToResponse(err);
    if (accessRes) return accessRes;
    return NextResponse.json(
      { ok: false, error: "access_check_failed" },
      { status: 500 },
    );
  }
  const attachmentId = documentId;
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
