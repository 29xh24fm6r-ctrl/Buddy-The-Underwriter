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

  const { data: deal, error: dealErr } = await sb
    .from("deals")
    .select("id, bank_id")
    .eq("id", dealId)
    .single();

  if (dealErr || !deal || deal.bank_id !== bankId) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const { data, error } = await sb
    .from("deal_pricing_inputs")
    .select("*")
    .eq("deal_id", dealId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, inputs: data ?? null });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  const { data: deal, error: dealErr } = await sb
    .from("deals")
    .select("id, bank_id")
    .eq("id", dealId)
    .single();

  if (dealErr || !deal || deal.bank_id !== bankId) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const body = await req.json();

  const patch = {
    deal_id: dealId,
    index_code: body.index_code ?? "SOFR",
    index_source: body.index_source ?? "nyfed",
    index_tenor: body.index_tenor ?? null,
    loan_amount: body.loan_amount ?? null,
    term_months: body.term_months ?? 120,
    amort_months: body.amort_months ?? 300,
    interest_only_months: body.interest_only_months ?? 0,
    spread_override_bps: body.spread_override_bps ?? null,
    base_rate_override_pct: body.base_rate_override_pct ?? null,
    notes: body.notes ?? null,
    index_rate_pct: body.index_rate_pct ?? null,
  };

  const { data, error } = await sb
    .from("deal_pricing_inputs")
    .upsert(patch, { onConflict: "deal_id" })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, inputs: data });
}
