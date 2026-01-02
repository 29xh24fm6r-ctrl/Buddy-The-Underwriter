// src/app/api/deals/[dealId]/uw/copilot/route.ts
import { NextResponse } from "next/server";
import { draftUwPackage } from "@/lib/uwCopilot/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await ctx.params;
    const out = await draftUwPackage(dealId);
    return NextResponse.json({ ok: true, result: out });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "uw copilot failed" },
      { status: 500 },
    );
  }
}
