/**
 * GET /api/deals/[dealId]/decision/latest - Get latest decision snapshot
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  await getCurrentBankId(); // Tenant check
  const sb = supabaseAdmin();

  const { data: snapshot, error } = await sb
    .from("decision_snapshots")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("Failed to fetch latest snapshot", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, snapshot });
}
