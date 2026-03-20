import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { loadBuilderPrefill } from "@/lib/builder/builderPrefill";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }

  const sb = supabaseAdmin();
  const prefill = await loadBuilderPrefill(dealId, sb);

  return NextResponse.json(prefill);
}
