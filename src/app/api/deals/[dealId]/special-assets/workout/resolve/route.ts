import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { resolveWorkoutCase } from "@/core/special-assets/updateWorkoutCase";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { userId } = await clerkAuth();
  if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { dealId } = await ctx.params;
  const body = await req.json();

  await resolveWorkoutCase({
    workoutCaseId: body.workoutCaseId, dealId, resolvedBy: userId,
    resolutionOutcome: body.resolutionOutcome, newStatus: body.status ?? "closed_other",
  });
  return NextResponse.json({ ok: true });
}
