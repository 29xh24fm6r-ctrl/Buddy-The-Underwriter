import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const dynamic = "force-dynamic";

type Params = Promise<{ dealId: string }>;

/**
 * POST /api/deals/[dealId]/risk-pricing/finalize
 * Finalize the risk pricing model — locks it and emits a ledger event.
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Params },
) {
  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: 404 });
  }

  const { finalizeRiskPricing } = await import("@/buddy/pricing/riskPricingService");
  const result = await finalizeRiskPricing(dealId);

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 422 });
  }

  return NextResponse.json({ ok: true, riskPricing: result.data });
}
