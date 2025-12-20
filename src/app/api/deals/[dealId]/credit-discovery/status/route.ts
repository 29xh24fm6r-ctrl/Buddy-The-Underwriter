// src/app/api/deals/[dealId]/credit-discovery/status/route.ts
import { NextResponse } from "next/server";
import { getDiscoveryStatus } from "@/lib/creditDiscovery/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ dealId: string }> }) {
  try {
    const { dealId } = await ctx.params;
    const out = await getDiscoveryStatus(dealId);
    return NextResponse.json({ ok: true, ...out });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "status failed" }, { status: 500 });
  }
}
