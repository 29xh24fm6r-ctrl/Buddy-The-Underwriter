import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { completeReviewCase } from "@/core/reviews/completeReviewCase";
import type { ReviewCaseType } from "@/core/reviews/types";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string; caseType: string; caseId: string }> },
) {
  const { userId } = await clerkAuth();
  if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { dealId, caseType, caseId } = await ctx.params;

  const result = await completeReviewCase({
    dealId, caseType: caseType as ReviewCaseType, caseId, completedBy: userId,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, newStatus: result.newStatus });
}
