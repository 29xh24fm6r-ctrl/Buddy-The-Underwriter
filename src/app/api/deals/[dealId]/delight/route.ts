// src/app/api/deals/[dealId]/delight/route.ts
// Record borrower delight moments (milestones, achievements)

import { NextResponse } from "next/server";
import { writeAiEvent } from "@/lib/aiEvents";
import { computeReadiness } from "@/lib/readiness";
import { resolveDealApiContext } from "@/lib/server/dealApiContext";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await params;
  const access = await resolveDealApiContext(dealId);
  if (!access.ok) {
    return NextResponse.json(
      { ok: false, error: access.error },
      { status: access.status },
    );
  }

  const { message, milestone } = await req.json();

  const { data: events, error } = await access.sb
    .from("ai_events")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[deal delight] event lookup failed", { dealId, code: error.code });
    return NextResponse.json(
      { ok: false, error: "delight_context_failed" },
      { status: 500 },
    );
  }

  const readiness = computeReadiness(events ?? []);

  await writeAiEvent({
    deal_id: dealId,
    kind: "borrower.delight.moment",
    scope: "ux",
    action: "celebrate",
    input_json: { milestone },
    output_json: {
      message:
        message ??
        `You're ${Math.round(readiness.score * 100)}% to E-Tran ready 🎉`,
      readiness_score: readiness.score,
      milestone,
    },
    confidence: 1.0,
  });

  return Response.json({ ok: true, message });
}
