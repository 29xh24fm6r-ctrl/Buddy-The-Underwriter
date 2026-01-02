// src/app/api/deals/[dealId]/credit-discovery/answer/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { answerAndAdvance } from "@/lib/creditDiscovery/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  sessionId: z.string().uuid(),
  questionId: z.string(),
  answerText: z.string().min(1),
  actorUserId: z.string().uuid().optional().nullable(),
});

export async function POST(
  req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await ctx.params;
    const body = BodySchema.parse(await req.json());
    const out = await answerAndAdvance({
      dealId,
      sessionId: body.sessionId,
      questionId: body.questionId,
      answerText: body.answerText,
      actorUserId: body.actorUserId ?? null,
    });
    return NextResponse.json({ ok: true, ...out });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "answer failed" },
      { status: 500 },
    );
  }
}
