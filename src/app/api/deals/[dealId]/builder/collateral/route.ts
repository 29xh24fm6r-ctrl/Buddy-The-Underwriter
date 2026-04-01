import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const sb = supabaseAdmin();
  const { data: items, error } = await sb
    .from("deal_collateral_items")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ items: items ?? [] });
}

export async function POST(req: Request, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const body = await req.json();
  const {
    item_type, description, estimated_value, lien_position,
    appraisal_date, address, valuation_method,
    valuation_source_note, advance_rate, net_lendable_value,
  } = body;

  if (!item_type) {
    return NextResponse.json({ error: "item_type is required" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: item, error } = await sb
    .from("deal_collateral_items")
    .insert({
      deal_id: dealId,
      item_type,
      description: description ?? null,
      estimated_value: estimated_value ?? null,
      lien_position: lien_position ?? 1,
      appraisal_date: appraisal_date ?? null,
      address: address ?? null,
      valuation_method: valuation_method ?? null,
      valuation_source_note: valuation_source_note ?? null,
      advance_rate: advance_rate ?? null,
      net_lendable_value: net_lendable_value ?? null,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ item }, { status: 201 });
}
