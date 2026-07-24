import "server-only";

/**
 * POST /api/deals/[dealId]/post-close/exceptions/[exceptionId]/resolve
 *
 * Resolve a monitoring exception.
 */

import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { resolveMonitoringException } from "@/core/post-close/resolveMonitoringException";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string; exceptionId: string }> },
) {
  let userId: string;
  try {
    ({ userId } = await requireUser());
  } catch {
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
