// src/app/api/deals/[dealId]/portal/uploads/unassigned/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertDealAccess } from "@/lib/server/deal-access";
import { accessErrorToResponse } from "@/lib/server/withDealAccess";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * Returns borrower uploads that are not assigned to a borrower_document_request.
 * Definition of "unassigned":
 * - borrower_uploads.request_id IS NULL
 * (and optionally: no match rows exist; we handle both)
 */
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  try {
    await assertDealAccess(dealId);
  } catch (err) {
    const accessRes = accessErrorToResponse(err);
    if (accessRes) return accessRes;
    return NextResponse.json(
      { error: "access_check_failed" },
      { status: 500 },
    );
  }
  const sb = supabaseAdmin();

  // Pull recent uploads
  const { data: uploads, error } = await sb
    .from("borrower_uploads")
    .select(
      "id,deal_id,bank_id,request_id,original_filename,mime_type,size_bytes,storage_bucket,storage_path,uploaded_at",
    )
    .eq("deal_id", dealId)
    .is("request_id", null)
    .order("uploaded_at", { ascending: false })
    .limit(100);

  if (error)
    return NextResponse.json(
      { error: "Failed to load uploads" },
      { status: 500 },
    );

  return NextResponse.json({ uploads: uploads || [] });
}
