// src/app/api/deals/[dealId]/ownership/compute/route.ts
import { NextRequest, NextResponse } from "next/server";
import { computeOwnershipFromDiscovery } from "@/lib/ownership/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await ctx.params;
    const out = await computeOwnershipFromDiscovery(dealId);
    return NextResponse.json({ ok: true, ...out });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ownership compute failed" },
      { status: 500 },
    );
  }
}
