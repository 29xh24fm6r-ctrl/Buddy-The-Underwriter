import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { calculateReadinessScore } from "@/lib/borrower/readiness-score";

/**
 * GET /api/deals/[dealId]/borrower/readiness-score
 * 
 * Returns the borrower-visible readiness score.
 * This is a progress proxy, NOT an approval indicator.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await context.params;
    const bankId = await getCurrentBankId();

    const sb = supabaseAdmin();

    // Verify deal access
    const { data: deal, error: dealError } = await sb
      .from("deals")
      .select("id")
      .eq("id", dealId)
      .eq("bank_id", bankId)
      .single();

    if (dealError || !deal) {
      return Response.json({ ok: false, error: "Deal not found" }, { status: 404 });
    }

    // Calculate readiness score
    const score = await calculateReadinessScore(dealId, bankId);

    return Response.json({
      ok: true,
      score,
    });
  } catch (err) {
    console.error("Readiness score API error:", err);
    return Response.json(
      { ok: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
