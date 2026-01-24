/**
 * GET /api/deals/[dealId]/artifacts
 *
 * Get artifact processing status and summary for a deal.
 */

import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ dealId: string }>;
};

export async function GET(req: NextRequest, ctx: Context) {
  try {
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { dealId } = await ctx.params;
    const bankId = await getCurrentBankId();

    const sb = supabaseAdmin();

    // Verify deal exists and belongs to bank
    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("id, bank_id")
      .eq("id", dealId)
      .maybeSingle();

    if (dealErr || !deal) {
      return NextResponse.json({ ok: false, error: "Deal not found" }, { status: 404 });
    }

    if (String(deal.bank_id) !== String(bankId)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 403 });
    }

    // Get summary via RPC
    const { data: summary, error: summaryErr } = await sb.rpc(
      "get_deal_artifacts_summary",
      { p_deal_id: dealId }
    );

    if (summaryErr) {
      console.error("[artifacts] summary error", summaryErr);
      return NextResponse.json(
        { ok: false, error: "Failed to get summary" },
        { status: 500 }
      );
    }

    // Get recent artifacts with details
    const { data: artifacts, error: artifactsErr } = await sb
      .from("document_artifacts")
      .select(`
        id,
        source_table,
        source_id,
        status,
        doc_type,
        doc_type_confidence,
        tax_year,
        entity_name,
        matched_checklist_key,
        match_confidence,
        proposed_deal_name,
        error_message,
        created_at,
        classified_at,
        matched_at
      `)
      .eq("deal_id", dealId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (artifactsErr) {
      console.error("[artifacts] list error", artifactsErr);
    }

    // Get pending matches that need review
    const { data: pendingMatches, error: matchesErr } = await sb
      .from("checklist_item_matches")
      .select(`
        id,
        artifact_id,
        checklist_key,
        confidence,
        reason,
        tax_year,
        status,
        created_at
      `)
      .eq("deal_id", dealId)
      .eq("status", "proposed")
      .order("created_at", { ascending: false })
      .limit(20);

    if (matchesErr) {
      console.error("[artifacts] matches error", matchesErr);
    }

    const summaryRow = Array.isArray(summary) ? summary[0] : summary;

    return NextResponse.json({
      ok: true,
      summary: summaryRow || {
        total_files: 0,
        queued: 0,
        processing: 0,
        classified: 0,
        matched: 0,
        failed: 0,
        proposed_matches: 0,
        auto_applied_matches: 0,
        confirmed_matches: 0,
      },
      artifacts: artifacts || [],
      pending_matches: pendingMatches || [],
    });
  } catch (error: any) {
    console.error("[artifacts] error", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
