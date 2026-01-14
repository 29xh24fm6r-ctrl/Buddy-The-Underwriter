// src/app/api/deals/[dealId]/packs/override/route.ts
// Record when a banker overrides pack recommendation
// Feeds learning system to improve future confidence

import { NextResponse } from "next/server";
import { recordLearningEvent } from "@/lib/packs/recordLearningEvent";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { clerkAuth } from "@/lib/auth/clerkServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  const body = await req.json().catch(() => ({}));

  const { matchEventId, reason } = body;

  if (!matchEventId) {
    return NextResponse.json(
      { ok: false, error: "Missing matchEventId" },
      { status: 400 },
    );
  }

  try {
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      const status = access.error === "unauthorized" ? 401 : 404;
      return NextResponse.json({ ok: false, error: access.error }, { status });
    }

    await recordLearningEvent({
      bankId: access.bankId,
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
    const msg = String(e?.message ?? e);
    return NextResponse.json(
      { ok: false, error: msg || "override_recording_failed" },
      { status: 500 },
    );
  }
}
