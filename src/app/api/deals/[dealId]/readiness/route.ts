import { NextResponse } from "next/server";
import { getDealReadiness } from "@/lib/deals/readiness";
import { requireRole } from "@/lib/auth/requireRole";

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
  await requireRole(["super_admin", "bank_admin", "underwriter"]);
  
  const { dealId } = await ctx.params;
  const { ready, reason } = await getDealReadiness(dealId);

  return NextResponse.json({
    ok: true,
    ready,
    reason,
  });
}
