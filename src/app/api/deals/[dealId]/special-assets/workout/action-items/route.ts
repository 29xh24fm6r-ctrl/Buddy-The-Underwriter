import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { addWorkoutActionItem, completeWorkoutActionItem } from "@/core/special-assets/workoutActionItems";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { userId } = await clerkAuth();
  if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { dealId } = await ctx.params;
  const body = await req.json();

  // Complete existing item
  if (body.action === "complete" && body.actionItemId) {
    const result = await completeWorkoutActionItem({ actionItemId: body.actionItemId, dealId, completedBy: userId });
    return NextResponse.json(result);
  }

  // Add new item
  const result = await addWorkoutActionItem({
    workoutCaseId: body.workoutCaseId,
    dealId,
    actionType: body.actionType ?? "other",
    title: body.title,
    description: body.description,
    dueAt: body.dueAt,
    ownerUserId: body.ownerUserId,
    createdBy: userId,
  });

  return NextResponse.json(result);
}
