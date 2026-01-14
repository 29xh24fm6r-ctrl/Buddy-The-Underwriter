import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { clerkAuth } from "@/lib/auth/clerkServer";

export const dynamic = "force-dynamic";

/**
 * GET /api/deals/[dealId]/pricing-memo/state?snapshotId=...
 *
 * Loads the latest derived underwriting artifacts for the selected snapshot:
 * - risk_facts (latest for snapshot)
 * - pricing_quote (latest for snapshot)
 * - generated_documents (credit memos for snapshot)
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await ctx.params;
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 },
      );
    }

    const bankId = await getCurrentBankId();

    const snapshotId = req.nextUrl.searchParams.get("snapshotId");
    if (!snapshotId) {
      return NextResponse.json(
        { ok: false, error: "snapshotId is required" },
        { status: 400 },
      );
    }

    const sb = supabaseAdmin();

    // Verify deal belongs to bank
    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("id")
      .eq("id", dealId)
      .eq("bank_id", bankId)
      .single();

    if (dealErr || !deal) {
      return NextResponse.json(
        { ok: false, error: "Deal not found" },
        { status: 404 },
      );
    }

    // Latest risk facts for this snapshot
    const { data: riskFacts, error: rfErr } = await sb
      .from("risk_facts")
      .select("*")
      .eq("deal_id", dealId)
      .eq("snapshot_id", snapshotId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (rfErr) {
      console.error("Failed to load risk facts:", rfErr);
      return NextResponse.json(
        { ok: false, error: "Failed to load risk facts" },
        { status: 500 },
      );
    }

    // Latest pricing quote for this snapshot
    const { data: pricingQuote, error: pqErr } = await sb
      .from("pricing_quotes")
      .select("*")
      .eq("deal_id", dealId)
      .eq("snapshot_id", snapshotId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (pqErr) {
      console.error("Failed to load pricing quote:", pqErr);
      return NextResponse.json(
        { ok: false, error: "Failed to load pricing quote" },
        { status: 500 },
      );
    }

    // Documents for this snapshot
    const { data: documents, error: docsErr } = await sb
      .from("generated_documents")
      .select("*")
      .eq("deal_id", dealId)
      .eq("snapshot_id", snapshotId)
      .eq("doc_type", "credit_memo")
      .order("created_at", { ascending: false });

    if (docsErr) {
      console.error("Failed to load documents:", docsErr);
      return NextResponse.json(
        { ok: false, error: "Failed to load documents" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      risk_facts: riskFacts ?? null,
      pricing_quote: pricingQuote ?? null,
      documents: documents ?? [],
    });
  } catch (e: any) {
    console.error("GET /api/deals/[dealId]/pricing-memo/state error:", e);
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 },
    );
  }
}
