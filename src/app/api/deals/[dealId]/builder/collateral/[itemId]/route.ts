import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ dealId: string; itemId: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const { dealId, itemId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const body = await req.json();
  const updates: Record<string, unknown> = {};
  for (const key of ["item_type", "description", "estimated_value", "lien_position", "appraisal_date", "address"]) {
    if (body[key] !== undefined) updates[key] = body[key];
  }
  updates.updated_at = new Date().toISOString();

  const sb = supabaseAdmin();
  const { data: item, error } = await sb
    .from("deal_collateral_items")
    .update(updates)
    .eq("id", itemId)
    .eq("deal_id", dealId)
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ item });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { dealId, itemId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const sb = supabaseAdmin();
  const { error } = await sb
    .from("deal_collateral_items")
    .delete()
    .eq("id", itemId)
    .eq("deal_id", dealId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
