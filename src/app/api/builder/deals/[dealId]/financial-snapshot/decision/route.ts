import "server-only";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { mustBuilderToken } from "@/lib/builder/mustBuilderToken";
import { resolveBuilderBankId } from "@/lib/builder/resolveBuilderBankId";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ dealId: string }> }) {
  mustBuilderToken(req);
  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();
  const bankId = await resolveBuilderBankId(sb);

  const { data: deal } = await sb
    .from("deals")
    .select("id, bank_id")
    .eq("id", dealId)
    .maybeSingle();

  if (!deal || String(deal.bank_id) !== String(bankId)) {
    return NextResponse.json({ ok: false, error: "deal_not_found" }, { status: 404 });
  }

  const { data: decision, error } = await sb
    .from("financial_snapshot_decisions")
    .select(
      "id, financial_snapshot_id, deal_id, bank_id, inputs_json, stress_json, sba_json, narrative_json, created_at",
    )
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (!decision) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const { data: snapshot } = await sb
    .from("financial_snapshots")
    .select("id, as_of_timestamp, snapshot_hash, created_at")
    .eq("id", decision.financial_snapshot_id)
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .maybeSingle();

  return NextResponse.json({ ok: true, dealId, decision, snapshot });
}
