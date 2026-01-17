import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
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

  const { data, error } = await sb
    .from("deal_pricing_quotes")
    .select("*, rate_index_snapshots(id, as_of_date, source, index_rate_pct, index_label)")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(25);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, quotes: data ?? [] });
}
