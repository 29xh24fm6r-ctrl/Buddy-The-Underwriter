// src/app/api/deals/[dealId]/credit-discovery/status/route.ts
import { NextResponse } from "next/server";
import { getDiscoveryStatus } from "@/lib/creditDiscovery/engine";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(
  _: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await ctx.params;
    const out = await getDiscoveryStatus(dealId);
    return NextResponse.json({ ok: true, ...out });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "status failed" },
      { status: 500 },
    );
  }
}
