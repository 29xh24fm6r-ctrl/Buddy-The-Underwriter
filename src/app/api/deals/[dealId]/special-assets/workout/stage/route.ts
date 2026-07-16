import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { updateWorkoutStage } from "@/core/special-assets/updateWorkoutCase";

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

  await updateWorkoutStage({ workoutCaseId: body.workoutCaseId, dealId, stage: body.stage, updatedBy: userId });
  return NextResponse.json({ ok: true });
}
