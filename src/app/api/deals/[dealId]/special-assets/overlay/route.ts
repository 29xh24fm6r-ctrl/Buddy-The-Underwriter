import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/lib/server/authz";
import { getDealRiskOverlay } from "@/core/special-assets/getDealRiskOverlay";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  let userId: string;
  try {
    ({ userId } = await requireUser());
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { dealId } = await ctx.params;

  try {
    const overlay = await getDealRiskOverlay(dealId);
    return NextResponse.json({ ok: true, overlay });
  } catch (err) {
    console.error("[GET overlay]", err);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
