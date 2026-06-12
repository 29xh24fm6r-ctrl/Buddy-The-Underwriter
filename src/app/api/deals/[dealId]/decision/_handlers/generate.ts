/**
 * POST /api/deals/[dealId]/decision/generate
 *
 * Auto-generates a proposed decision snapshot from the current financial
 * snapshot. Used by DecisionStartPage when the inline generation in the
 * decision page failed and the banker clicks "Generate Decision".
 */
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { generateDecisionSnapshot } from "@/lib/decision/generateDecisionSnapshot";

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json(
      { ok: false, error: access.error },
      { status: access.error === "deal_not_found" ? 404 : 403 },
    );
  }
  const sb = supabaseAdmin();
  const result = await generateDecisionSnapshot({
    dealId,
    bankId: access.bankId,
    sb,
  });
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  }
  return NextResponse.json({ ok: true, id: result.id });
}
