// src/app/api/deals/[dealId]/packs/override/route.ts
// Record when a banker overrides pack recommendation
// Feeds learning system to improve future confidence

import { NextRequest, NextResponse } from "next/server";
import { recordLearningEvent } from "@/lib/packs/recordLearningEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const { bankId, matchEventId, reason } = body;

  if (!bankId || !matchEventId) {
    return NextResponse.json(
      { ok: false, error: "Missing bankId or matchEventId" },
      { status: 400 },
    );
  }

  try {
    await recordLearningEvent({
      bankId,
      matchEventId,
      eventType: "override",
      metadata: {
        overridden: true,
        override_reason: reason || "No reason provided",
        deal_id: dealId,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "override_recording_failed" },
      { status: 500 },
    );
  }
}
