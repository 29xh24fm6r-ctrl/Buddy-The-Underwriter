// src/app/api/banker/deals/[dealId]/pricing/compute/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { computePricing, formatBorrowerRate } from "@/lib/pricing/compute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Banker-only endpoint to compute risk-based pricing
 *
 * Returns full explainability (internal use only)
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    // TODO: Add banker auth check
    // const banker = await requireBankerAuth(req);

    const { dealId } = await ctx.params;
    const body = await req.json();

    const input = {
      dealId,
      productType: String(body.productType ?? "SBA_7A"),
      riskGrade: String(body.riskGrade ?? "5"),
      termMonths: Number(body.termMonths ?? 120),
      indexName: String(body.indexName ?? "SOFR"),
      indexRateBps: Number(body.indexRateBps ?? 500), // 5.00%
    };

    const result = await computePricing(input);

    return NextResponse.json({
      ok: true,
      quote: {
        id: result.quoteId,
        finalRate: formatBorrowerRate(result.finalRateBps),
        finalRateBps: result.finalRateBps,
        baseSpreadBps: result.baseSpreadBps,
        overrideSpreadBps: result.overrideSpreadBps,
        explain: result.explain,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Pricing computation failed" },
      { status: 400 },
    );
  }
}
