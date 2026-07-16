import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { escalateWatchlistToWorkout } from "@/core/special-assets/escalateToWorkout";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  let userId: string;
  try {
    ({ userId } = await requireUser());
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let bankId: string;
  try { bankId = await getCurrentBankId(); } catch {
    return NextResponse.json({ ok: false, error: "No bank" }, { status: 403 });
  }

  const { dealId } = await ctx.params;
  const body = await req.json();

  const result = await escalateWatchlistToWorkout({
    watchlistCaseId: body.watchlistCaseId,
    dealId,
    bankId,
    escalatedBy: userId,
    workoutSeverity: body.severity ?? "high",
    workoutStrategy: body.strategy ?? "short_term_cure",
  });

  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, workoutCaseId: result.caseId });
}
