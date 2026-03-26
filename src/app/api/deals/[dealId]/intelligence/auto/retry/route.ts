import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { enqueueAutoIntelligenceRun } from "@/lib/intelligence/auto/enqueueAutoIntelligenceRun";
import { runAutoIntelligencePipeline } from "@/lib/intelligence/auto/runAutoIntelligencePipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * POST /api/deals/[dealId]/intelligence/auto/retry
 * Retry the auto-intelligence pipeline.
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const enqueue = await enqueueAutoIntelligenceRun({
    dealId,
    bankId: auth.bankId,
    source: "manual_retry",
    createdBy: auth.userId,
  });

  if (!enqueue.ok) return NextResponse.json({ ok: false, error: enqueue.error }, { status: 500 });

  if (enqueue.alreadyActive) {
    return NextResponse.json({ ok: true, status: "already_running", runId: enqueue.runId });
  }

  // Run inline for now (production should use async worker)
  const result = await runAutoIntelligencePipeline({
    dealId,
    bankId: auth.bankId,
    runId: enqueue.runId,
    actorUserId: auth.userId,
    source: "manual_retry",
  });

  return NextResponse.json(result);
}
