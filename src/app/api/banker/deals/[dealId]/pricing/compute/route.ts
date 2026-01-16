// src/app/api/banker/deals/[dealId]/pricing/compute/route.ts
import { NextResponse } from "next/server";
import { computePricing, formatBorrowerRate } from "@/lib/pricing/compute";
import { z } from "zod";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRole } from "@/lib/auth/requireRole";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  productType: z.string().optional(),
  riskGrade: z.string().optional(),
  termMonths: z.number().int().positive().optional(),
  indexName: z.string().optional(),
  indexRateBps: z.number().int().nonnegative().optional(),
});

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
    await requireRole(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok)
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "unauthorized" ? 401 : 403 },
      );

    const body = BodySchema.parse(await req.json().catch(() => ({})));

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
