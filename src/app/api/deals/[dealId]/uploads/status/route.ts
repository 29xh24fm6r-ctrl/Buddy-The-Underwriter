import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

// GET /api/deals/[dealId]/uploads/status
// Returns live status of document uploads for a deal
export async function GET(
  _req: Request,
  ctx: Ctx
) {
  try {
    const bankId = await getCurrentBankId();
    const sb = supabaseAdmin();
    const { dealId } = await ctx.params;

    // Validate deal access
    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("id, bank_id")
      .eq("id", dealId)
      .eq("bank_id", bankId)
      .single();

    if (dealErr || !deal) {
      return NextResponse.json(
        { ok: false, error: "Deal not found or unauthorized" },
        { status: 404 }
      );
    }

    // Get all uploads for the deal (using canonical deal_documents table)
    const { data: uploads, error: uploadsErr } = await sb
      .from("deal_documents")
      .select("id, original_filename, created_at")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false });

    if (uploadsErr) {
      console.error("Failed to fetch deal documents:", uploadsErr);
      return NextResponse.json(
        { ok: false, error: "Database error fetching documents" },
        { status: 500 }
      );
    }

    // All documents in deal_documents are considered "processed"
    const total = uploads?.length || 0;
    const processed = total; // All docs in deal_documents are already processed
    
    const isProcessing = false; // No processing needed - all in DB are done
    const allDocsReceived = total > 0;

    return NextResponse.json({
      ok: true,
      total,
      processed,
      isProcessing,
      allDocsReceived,
      uploads: (uploads || []).map(u => ({
        id: u.id,
        status: "processed",
        original_filename: u.original_filename,
      })),
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message },
      { status: 500 }
    );
  }
}