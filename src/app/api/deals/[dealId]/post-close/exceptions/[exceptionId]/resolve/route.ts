import "server-only";

/**
 * POST /api/deals/[dealId]/post-close/exceptions/[exceptionId]/resolve
 *
 * Resolve a monitoring exception.
 */

import { NextResponse, type NextRequest } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { resolveMonitoringException } from "@/core/post-close/resolveMonitoringException";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string; exceptionId: string }> },
) {
  const { userId } = await clerkAuth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { dealId, exceptionId } = await ctx.params;
  let body: { note?: string; status?: string } = {};
  try {
    body = await req.json();
  } catch {
    // optional body
  }

  const result = await resolveMonitoringException({
    exceptionId,
    dealId,
    resolvedBy: userId,
    resolutionNote: body.note,
    newStatus: (body.status as "resolved" | "waived") ?? "resolved",
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
