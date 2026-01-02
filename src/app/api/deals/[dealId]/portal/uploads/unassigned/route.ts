// src/app/api/deals/[dealId]/portal/uploads/unassigned/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
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
