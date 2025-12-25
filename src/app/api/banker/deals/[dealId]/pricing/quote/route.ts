// src/app/api/banker/deals/[dealId]/pricing/quote/route.ts
import { NextResponse } from "next/server";
import { computePricing } from "@/lib/pricing/compute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireUserId(req: Request) {
  const userId = req.headers.get("x-user-id");
  if (!userId) throw new Error("Missing x-user-id header.");
  return userId;
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const userId = requireUserId(req);
    const { dealId } = await ctx.params;
    const body = await req.json();
    const productType = String(body?.productType ?? "");
    const riskGrade = String(body?.riskGrade ?? "");
    const termMonths = Number(body?.termMonths ?? 0);
    const indexName = String(body?.indexName ?? "SOFR");
    const indexRateBps = Number(body?.indexRateBps ?? 0);

    if (!productType || !riskGrade || !termMonths)
      throw new Error("Missing inputs.");

    const res = await computePricing({
      dealId,
      productType,
      riskGrade,
      termMonths,
      indexName,
      indexRateBps,
    });

    return NextResponse.json(res);
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 400 },
    );
  }
}
