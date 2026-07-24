import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertDealAccess } from "@/lib/server/deal-access";
import { accessErrorToResponse } from "@/lib/server/withDealAccess";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * GET /api/deals/[dealId]/uploads/status
 *
 * Backs UploadStatusCard's 2.5s poll. Uses the same "classified" signal
 * pipeline-status.ts already treats as the processing-complete proxy for a
 * deal_documents row (document_type set once classification finishes) —
 * avoids depending on document_jobs.attachment_id, which references
 * borrower_attachments rather than deal_documents directly.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const { bankId } = await assertDealAccess(dealId);

    const sb = supabaseAdmin();
    const { data, error } = await sb
      .from("deal_documents")
      .select("id, original_filename, document_type, created_at")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId);

    if (error) throw error;

    const docs = (data ?? []) as Array<{
      id: string;
      original_filename: string | null;
      document_type: string | null;
      created_at: string;
    }>;

    const total = docs.length;
    const processed = docs.filter((d) => d.document_type != null).length;
    const isProcessing = total > processed;

    const uploads = docs.map((d) => ({
      id: d.id,
      original_filename: d.original_filename ?? "Document",
      status: d.document_type != null ? "processed" : "processing",
    }));

    return NextResponse.json({
      ok: true,
      total,
      processed,
      isProcessing,
      allDocsReceived: total > 0,
      uploads,
    });
  } catch (e: any) {
    const accessRes = accessErrorToResponse(e);
    if (accessRes) return accessRes;
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 500 },
    );
  }
}
