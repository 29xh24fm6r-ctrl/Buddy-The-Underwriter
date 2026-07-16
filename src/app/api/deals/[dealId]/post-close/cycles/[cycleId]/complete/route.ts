import "server-only";

/**
 * POST /api/deals/[dealId]/post-close/cycles/[cycleId]/complete
 *
 * Banker-confirmed cycle completion.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { completeMonitoringCycle } from "@/core/post-close/completeMonitoringCycle";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string; cycleId: string }> },
) {
  let userId: string;
  try {
    ({ userId } = await requireUser());
  } catch {
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
