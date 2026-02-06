import { NextRequest, NextResponse } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/deals/[dealId]/spreads/line-items
 *
 * Returns normalized spread line items for a deal.
 * Query params:
 *   - spread_type: filter by spread type (e.g. "T12", "BALANCE_SHEET")
 *   - period: filter by period_label (e.g. "2024-01", "TTM")
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ dealId?: string }> },
) {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { dealId } = await params;
  if (!dealId) {
    return NextResponse.json({ error: "Missing dealId" }, { status: 400 });
  }

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: 403 });
  }

  const sb = supabaseAdmin();
  const url = new URL(request.url);
  const spreadType = url.searchParams.get("spread_type");
  const period = url.searchParams.get("period");

  let query = (sb as any)
    .from("deal_spread_line_items")
    .select("*")
    .eq("deal_id", dealId)
    .eq("bank_id", access.bankId)
    .order("sort_order", { ascending: true });

  if (spreadType) {
    query = query.eq("spread_type", spreadType);
  }
  if (period) {
    query = query.eq("period_label", period);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[spreads/line-items] query failed:", error.message);
    return NextResponse.json({ error: "Failed to fetch line items" }, { status: 500 });
  }

  return NextResponse.json({ line_items: data ?? [] });
}
