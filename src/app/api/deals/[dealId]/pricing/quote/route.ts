// src/app/api/deals/[dealId]/pricing/quote/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { quotePricing } from "@/lib/pricing/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  requestedAmount: z.number().positive(),
  termMonths: z.number().int().positive(),
  riskRating: z.number().int().min(1).max(10),
  collateralStrength: z.enum(["strong", "moderate", "weak"]),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await ctx.params;
    const body = BodySchema.parse(await req.json());
    const out = await quotePricing({ dealId, ...body });
    return NextResponse.json({ ok: true, ...out });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "pricing quote failed" },
      { status: 500 },
    );
  }
}
