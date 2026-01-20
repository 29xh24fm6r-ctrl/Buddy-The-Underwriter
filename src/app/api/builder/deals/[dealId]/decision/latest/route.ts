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

  const { data: snapshot, error } = await sb
    .from("decision_snapshots")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, snapshot });
}
