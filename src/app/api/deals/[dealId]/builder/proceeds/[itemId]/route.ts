import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ dealId: string; itemId: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  const { dealId, itemId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const sb = supabaseAdmin();
  const { error } = await sb
    .from("deal_proceeds_items")
    .delete()
    .eq("id", itemId)
    .eq("deal_id", dealId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
