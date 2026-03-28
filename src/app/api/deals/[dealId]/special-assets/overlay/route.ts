import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { getDealRiskOverlay } from "@/core/special-assets/getDealRiskOverlay";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { userId } = await clerkAuth();
  if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { dealId } = await ctx.params;

  try {
    const overlay = await getDealRiskOverlay(dealId);
    return NextResponse.json({ ok: true, overlay });
  } catch (err) {
    console.error("[GET overlay]", err);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
