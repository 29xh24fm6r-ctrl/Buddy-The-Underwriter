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

    // Get all uploads for the deal
    const { data: uploads, error: uploadsErr } = await sb
      .from("deal_uploads")
      .select("id, status, original_filename")
      .eq("deal_id", dealId);

    if (uploadsErr) {
      console.error("Failed to fetch deal uploads:", uploadsErr);
      return NextResponse.json(
        { ok: false, error: "Database error fetching uploads" },
        { status: 500 }
      );
    }

    const total = uploads.length;
    const processed = uploads.filter(
      (u) => u.status === "processed" || u.status === "matched" || u.status === "failed"
    ).length;
    
    const isProcessing = total > 0 && processed < total;
    const allDocsReceived = total > 0 && processed === total;

    return NextResponse.json({
      ok: true,
      total,
      processed,
      isProcessing,
      allDocsReceived,
      uploads: uploads,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message },
      { status: 500 }
    );
  }
}