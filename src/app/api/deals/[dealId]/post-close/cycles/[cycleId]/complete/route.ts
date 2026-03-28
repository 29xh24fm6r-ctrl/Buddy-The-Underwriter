import "server-only";

/**
 * POST /api/deals/[dealId]/post-close/cycles/[cycleId]/complete
 *
 * Banker-confirmed cycle completion.
 */

import { NextResponse, type NextRequest } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { completeMonitoringCycle } from "@/core/post-close/completeMonitoringCycle";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string; cycleId: string }> },
) {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { dealId, cycleId } = await ctx.params;

  const result = await completeMonitoringCycle({
    cycleId,
    dealId,
    reviewedBy: userId,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
