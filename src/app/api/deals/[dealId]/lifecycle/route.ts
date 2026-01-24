import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { deriveLifecycleState } from "@/buddy/lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = Promise<{ dealId: string }>;

/**
 * GET /api/deals/[dealId]/lifecycle
 *
 * Returns the current lifecycle state for a deal.
 * This is the single source of truth for "where is this deal and what's blocking it?"
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Params }
): Promise<NextResponse> {
  try {
    const { dealId } = await ctx.params;

    // Verify deal access
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 }
      );
    }

    // Derive current lifecycle state
    const state = await deriveLifecycleState(dealId);

    // Check if deal wasn't found during derivation
    if (state.blockers.some((b) => b.code === "deal_not_found")) {
      return NextResponse.json(
        { ok: false, error: "deal_not_found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      state,
    });
  } catch (error) {
    console.error("[/api/deals/[dealId]/lifecycle] Error:", error);
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 }
    );
  }
}
