import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const sb = supabaseAdmin();
  const { data: items, error } = await sb
    .from("deal_proceeds_items")
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
  const { category, description, amount } = body;

  if (!category) {
    return NextResponse.json({ error: "category is required" }, { status: 400 });
  }
  if (amount == null || typeof amount !== "number") {
    return NextResponse.json({ error: "amount is required and must be a number" }, { status: 400 });
  }

  const sb = supabaseAdmin();
  const { data: item, error } = await sb
    .from("deal_proceeds_items")
    .insert({
      deal_id: dealId,
      category,
      description: description ?? null,
      amount,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ item }, { status: 201 });
}
