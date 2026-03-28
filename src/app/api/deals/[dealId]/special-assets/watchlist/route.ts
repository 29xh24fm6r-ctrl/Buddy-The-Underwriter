import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { openWatchlistCase } from "@/core/special-assets/openWatchlistCase";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { userId } = await clerkAuth();
  if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let bankId: string;
  try { bankId = await getCurrentBankId(); } catch {
    return NextResponse.json({ ok: false, error: "No bank" }, { status: 403 });
  }

  const { dealId } = await ctx.params;
  const body = await req.json();

  const result = await openWatchlistCase({
    dealId,
    bankId,
    severity: body.severity ?? "moderate",
    primaryReason: body.primaryReason ?? "other",
    openedBy: userId,
    assignedTo: body.assignedTo,
    reasons: body.reasons,
  });

  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, caseId: result.caseId, created: result.created });
}
