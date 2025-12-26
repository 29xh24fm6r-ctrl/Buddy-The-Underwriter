// src/app/api/deals/[dealId]/context/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import type { DealContext } from "@/lib/deals/contextTypes";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await ctx.params;
    const bankId = await getCurrentBankId();
    const sb = supabaseAdmin();

    // Fetch deal with basic info
    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("id, bank_id, borrower_name, entity_type, stage, risk_score")
      .eq("id", dealId)
      .eq("bank_id", bankId)
      .single();

    if (dealErr || !deal) {
      return NextResponse.json(
        { ok: false, error: "Deal not found" },
        { status: 404 }
      );
    }

    // Count missing documents
    const { count: missingDocs } = await sb
      .from("deal_document_requirements")
      .select("*", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .eq("status", "missing");

    // Count open conditions
    const { count: openConditions } = await sb
      .from("deal_conditions")
      .select("*", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .in("status", ["pending", "in_progress"]);

    // Get risk flags (placeholder - customize based on your schema)
    const riskFlags: string[] = [];
    if (deal.risk_score && deal.risk_score > 70) {
      riskFlags.push("High Risk Score");
    }

    // Build context
    const context: DealContext = {
      dealId: deal.id,
      stage: (deal.stage as DealContext["stage"]) ?? "intake",

      borrower: {
        name: deal.borrower_name ?? "Unknown Borrower",
        entityType: deal.entity_type ?? "Unknown",
      },

      risk: {
        score: deal.risk_score ?? 0,
        flags: riskFlags,
      },

      completeness: {
        missingDocs: missingDocs ?? 0,
        openConditions: openConditions ?? 0,
      },

      permissions: {
        canApprove: true, // TODO: implement real permission logic
        canRequest: true,
        canShare: true,
      },
    };

    return NextResponse.json(context);
  } catch (e: any) {
    console.error("GET /api/deals/[dealId]/context error:", e);
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
