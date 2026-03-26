import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * POST /api/deals/[dealId]/financial-validation/rebuild
 *
 * Banker-initiated snapshot rebuild. Idempotent.
 * Auth: Clerk session + deal cockpit access.
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  try {
    // Log the rebuild request
    await logLedgerEvent({
      dealId,
      bankId: auth.bankId,
      eventKey: "financial_snapshot.rebuild_requested",
      uiState: "working",
      uiMessage: "Financial snapshot rebuild requested by banker",
      meta: {
        trigger_source: "manual_rebuild",
        requested_by: auth.userId,
      },
    });

    // Trigger snapshot recompute via the existing financial snapshot endpoint
    // This delegates to the standard recompute path which rebuilds the snapshot
    const { recomputeDealReady } = await import("@/lib/deals/readiness");
    await recomputeDealReady(dealId);

    return NextResponse.json({ ok: true, status: "accepted" });
  } catch (err: any) {
    console.error("[financial-validation/rebuild] Failed", {
      dealId,
      error: err?.message,
    });
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Rebuild failed" },
      { status: 500 },
    );
  }
}
