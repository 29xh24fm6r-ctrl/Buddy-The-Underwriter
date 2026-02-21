import { NextResponse } from "next/server";
import { getDealReadiness } from "@/lib/deals/readiness";
import { requireRoleApi, AuthorizationError } from "@/lib/auth/requireRole";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = {
  params: Promise<{ dealId: string }>;
};

/**
 * GET /api/deals/:dealId/readiness
 * 
 * Returns cached deal readiness state.
 * This is fast - just reads from deals.ready_at/ready_reason.
 * Actual computation happens on event triggers (upload, reconcile, etc).
 */
export async function GET(req: Request, ctx: Context) {
  try {
    await requireRoleApi(["super_admin", "bank_admin", "underwriter"]);
  } catch (e: any) {
    rethrowNextErrors(e);
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  try {
    const { dealId } = await ctx.params;
    const { ready, reason } = await getDealReadiness(dealId);

    return NextResponse.json({
      ok: true,
      ready,
      reason,
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
