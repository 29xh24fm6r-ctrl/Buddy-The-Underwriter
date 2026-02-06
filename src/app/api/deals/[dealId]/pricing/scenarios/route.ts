import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const bankId = await getCurrentBankId();
    const sb = supabaseAdmin();

    const { data: deal } = await sb
      .from("deals")
      .select("id, bank_id")
      .eq("id", dealId)
      .maybeSingle();

    if (!deal || deal.bank_id !== bankId) {
      return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
    }

    const [scenariosRes, decisionRes] = await Promise.all([
      sb
        .from("pricing_scenarios")
        .select("*")
        .eq("deal_id", dealId)
        .eq("bank_id", bankId)
        .order("created_at", { ascending: true }),
      sb
        .from("pricing_decisions")
        .select("*, pricing_terms(*)")
        .eq("deal_id", dealId)
        .eq("bank_id", bankId)
        .maybeSingle(),
    ]);

    return NextResponse.json({
      ok: true,
      dealId,
      scenarios: scenariosRes.data ?? [],
      decision: decisionRes.data ?? null,
    });
  } catch (e: any) {
    console.error("[GET /pricing/scenarios]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
