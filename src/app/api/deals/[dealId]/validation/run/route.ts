import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { runBuddyValidationPass } from "@/lib/validation/buddyValidationPass";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { userId } = await clerkAuth();
  if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { dealId } = await ctx.params;

  try {
    const report = await runBuddyValidationPass(dealId);
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    console.error("[POST validation/run]", err);
    return NextResponse.json({ ok: false, error: "Validation failed" }, { status: 500 });
  }
}
