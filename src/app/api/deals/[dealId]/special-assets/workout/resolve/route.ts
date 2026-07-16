import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { resolveWorkoutCase } from "@/core/special-assets/updateWorkoutCase";

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

  const { dealId } = await ctx.params;
  const body = await req.json();

  await resolveWorkoutCase({
    workoutCaseId: body.workoutCaseId, dealId, resolvedBy: userId,
    resolutionOutcome: body.resolutionOutcome, newStatus: body.status ?? "closed_other",
  });
  return NextResponse.json({ ok: true });
}
