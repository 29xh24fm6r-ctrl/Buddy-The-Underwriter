// src/app/api/deals/[dealId]/spreads/combined/generate/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

/**
 * POST /api/deals/[dealId]/spreads/combined/generate
 *
 * SPEC-CURRENT-STAGE-AUDIT-FIX-2: this route was an unfinished dev STUB — it had no auth, read a
 * local `.data/entities/<dealId>` directory that does not exist in production, FABRICATED financials
 * with `Math.random()`, and persisted nothing. Serving fabricated, unauthenticated financial numbers
 * from a credit-decision surface is unacceptable, so it is disabled: it now requires deal cockpit
 * access and returns 501 Not Implemented rather than fake data. Combined multi-entity spreads are
 * produced by the real spreads pipeline (enqueueSpreadRecompute → spreadsProcessor → deal_spreads);
 * wiring a dedicated combined-generate endpoint to that pipeline is tracked as follow-up work.
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  if (!dealId) {
    return json(400, { ok: false, error: "Missing dealId" });
  }

  const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
  if (!auth.ok) {
    return json(auth.status, { ok: false, error: auth.error });
  }

  return json(501, {
    ok: false,
    error: "not_implemented",
    message:
      "Combined multi-entity spread generation is not implemented via this endpoint. Use the spreads recompute pipeline; this stub previously returned fabricated data and has been disabled.",
  });
}
