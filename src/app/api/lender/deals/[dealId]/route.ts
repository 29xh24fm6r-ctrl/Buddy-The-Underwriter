import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * GET /api/lender/deals/[dealId]
 * 
 * Lender-Facing Data (Read-Only)
 * 
 * - No mutations allowed
 * - No tenant gating (lenders see across banks)
 * - Minimal, trustable data contract
 * - Ledger-derived explanations
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await context.params;
  const sb = supabaseAdmin();

  try {
    // Fetch deal
    const { data: deal, error: dealError } = await sb
      .from("deals")
      .select("id, borrower_name, amount, ready_at, ready_reason, submitted_at, created_at")
      .eq("id", dealId)
      .single();

    if (dealError || !deal) {
      return NextResponse.json(
        { ok: false, error: "Deal not found" },
        { status: 404 }
      );
    }

    // Fetch checklist summary
    const { data: checklistItems } = await sb
      .from("deal_checklist_items")
      .select("required, received_at")
      .eq("deal_id", dealId);

    const required = checklistItems?.filter((i) => i.required).length || 0;
    const satisfied = checklistItems?.filter((i) => i.required && i.received_at).length || 0;

    // Fetch documents
    const { data: documents } = await sb
      .from("deal_documents")
      .select("id, original_filename, uploaded_at, finalized_at")
      .eq("deal_id", dealId)
      .order("uploaded_at", { ascending: false });

    // Fetch latest ledger event
    const { data: ledgerEvents } = await sb
      .from("deal_pipeline_ledger")
      .select("stage, status, payload, created_at")
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(5);

    return NextResponse.json({
      ok: true,
      deal: {
        id: deal.id,
        borrower_name: deal.borrower_name,
        amount: deal.amount,
        ready_at: deal.ready_at,
        ready_reason: deal.ready_reason,
        submitted_at: deal.submitted_at,
        created_at: deal.created_at,
      },
      checklist_summary: {
        required,
        satisfied,
      },
      documents: documents || [],
      timeline: ledgerEvents || [],
    });
  } catch (err: any) {
    console.error("[lender] Error fetching deal", { dealId, error: err.message });
    return NextResponse.json(
      { ok: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
