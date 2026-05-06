import { NextResponse } from "next/server";
import { getDealReadiness } from "@/lib/deals/readiness";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { requireDealAccess } from "@/lib/auth/requireDealAccess";
import { buildUnifiedDealReadiness } from "@/lib/deals/readiness/buildUnifiedDealReadiness";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Context = {
  params: Promise<{ dealId: string }>;
};

/**
 * GET /api/deals/:dealId/readiness
 *
 * Returns the canonical UnifiedDealReadiness for the deal — merged across
 * documents, financials, research, memo inputs, and credit memo. The
 * legacy `{ ready, reason }` shape is preserved alongside the new
 * `readiness` field for backwards compatibility with existing callers
 * (e.g. DealStatusBanner).
 */
export async function GET(_req: Request, ctx: Context) {
  try {
    const { dealId } = await ctx.params;
    await requireDealAccess(dealId);

    const [legacy, unified] = await Promise.all([
      getDealReadiness(dealId).catch(() => ({ ready: false, reason: null })),
      buildUnifiedDealReadiness({ dealId, runReconciliation: true }),
    ]);

    if (!unified.ok) {
      return NextResponse.json(
        {
          ok: false,
          reason: unified.reason,
          error: unified.error ?? null,
          // Surface legacy fields when available so callers keep working.
          ready: (legacy as { ready?: boolean }).ready ?? false,
        },
        { status: unified.reason === "tenant_mismatch" ? 403 : 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      // Legacy fields — DealStatusBanner expects these.
      ready: (legacy as { ready?: boolean }).ready ?? unified.readiness.ready,
      reason: (legacy as { reason?: unknown }).reason ?? null,
      // Unified readiness — preferred by JourneyRail, DealShell, memo-inputs.
      readiness: unified.readiness,
    });
  } catch (e: any) {
    rethrowNextErrors(e);
    console.error("[readiness] unexpected error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 },
    );
  }
}
