import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { resolveWatchlistCase } from "@/core/special-assets/resolveWatchlistCase";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { userId } = await clerkAuth();
  if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { dealId } = await ctx.params;
  const body = await req.json();

  if (!body.watchlistCaseId || !body.resolutionSummary) {
    return NextResponse.json({ ok: false, error: "watchlistCaseId and resolutionSummary required" }, { status: 400 });
  }

  await resolveWatchlistCase({
    watchlistCaseId: body.watchlistCaseId,
    dealId,
    resolvedBy: userId,
    resolutionSummary: body.resolutionSummary,
    newStatus: body.status ?? "resolved",
  });

  return NextResponse.json({ ok: true });
}
