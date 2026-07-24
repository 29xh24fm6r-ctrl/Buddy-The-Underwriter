// src/app/api/deals/[dealId]/status/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { assertDealAccess } from "@/lib/server/deal-access";
import { accessErrorToResponse } from "@/lib/server/withDealAccess";
import { upsertDealStatusAndLog, type DealStage } from "@/lib/deals/status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STAGES = new Set<DealStage>([
  "intake",
  "docs_in_progress",
  "analysis",
  "underwriting",
  "conditional_approval",
  "closing",
  "funded",
  "declined",
]);

/**
 * PATCH /api/deals/[dealId]/status
 *
 * Backs DealStageEtaControls (banker cockpit stage/ETA editor). Upserts
 * deal_status and writes the visible-to-borrower timeline events via the
 * existing upsertDealStatusAndLog helper (already used by
 * underwrite/start and advanceDealLifecycle).
 */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  try {
    const { dealId } = await ctx.params;
    const { userId } = await assertDealAccess(dealId);

    const body = await req.json().catch(() => ({}));
    const { stage, etaDate, etaNote } = body ?? {};

    if (stage !== undefined && !VALID_STAGES.has(stage)) {
      return NextResponse.json({ ok: false, error: "Invalid stage" }, { status: 400 });
    }

    const saved = await upsertDealStatusAndLog({
      dealId,
      stage,
      etaDate,
      etaNote,
      actorUserId: userId,
    });

    return NextResponse.json({ ok: true, status: saved });
  } catch (e: any) {
    const accessRes = accessErrorToResponse(e);
    if (accessRes) return accessRes;
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unknown error" },
      { status: 400 },
    );
  }
}
