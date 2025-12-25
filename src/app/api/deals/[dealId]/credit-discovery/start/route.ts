// src/app/api/deals/[dealId]/credit-discovery/start/route.ts
import { NextRequest, NextResponse } from "next/server";
import { startOrGetSession } from "@/lib/creditDiscovery/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await ctx.params;
    const session = await startOrGetSession(dealId);
    return NextResponse.json({
      ok: true,
      session,
      nextQuestion: session.last_question_json,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "start failed" },
      { status: 500 },
    );
  }
}
