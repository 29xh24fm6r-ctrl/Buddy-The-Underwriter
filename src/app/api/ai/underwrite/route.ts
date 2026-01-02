import { withApiGuard } from "@/lib/api/withApiGuard";
import { NextResponse } from "next/server";
import { runUnderwritingDecision } from "@/ai/orchestrator/run";
import { clerkAuth, isClerkConfigured } from "@/lib/auth/clerkServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withApiGuard({ tag: "ai:underwrite", requireAuth: true, rate: { limit: 30, windowMs: 60_000 } }, async (req: any) => {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const narrative = body?.narrative as string | undefined;
  const deep = Boolean(body?.deep_reasoning);
  const dealId = body?.dealId as string | undefined;
  const borrowerName = body?.borrowerName as string | undefined;

  if (!narrative) {
    return NextResponse.json({ error: "narrative_required" }, { status: 400 });
  }

  try {
    const result = await runUnderwritingDecision({
      task: deep ? "deep_reasoning" : "default",
      input: {
        dealId,
        borrowerName,
        narrative,
      },
      userId,
    });

    return NextResponse.json({ result });
  } catch (error) {
    console.error("[API /ai/underwrite] Error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "AI processing failed",
      },
      { status: 500 },
    );
  }
});
