// src/app/api/deals/[dealId]/packs/recommend/route.ts
import { NextResponse } from "next/server";
import { getPackRecommendation } from "@/lib/packs/getPackRecommendation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  try {
    const recommendation = await getPackRecommendation(dealId);

    if (!recommendation) {
      return NextResponse.json({
        ok: true,
        recommendation: null,
        message: "No suitable pack found",
      });
    }

    return NextResponse.json({ ok: true, recommendation });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "recommendation_failed" },
      { status: 500 },
    );
  }
}
