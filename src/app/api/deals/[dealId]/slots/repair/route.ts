import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { requireUnderwriterOnDeal } from "@/lib/auth/requireUnderwriterOnDeal";
import { ensureEntityBindings } from "@/lib/intake/slots/repair/ensureEntityBindings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/deals/[dealId]/slots/repair
 *
 * On-demand entity binding repair for a deal.
 * Requires authenticated underwriter access.
 *
 * Runs ensureEntityBindings() synchronously — throws on structural invariant violation.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
): Promise<NextResponse> {
  const { dealId } = await ctx.params;

  try {
    await requireUnderwriterOnDeal(dealId);
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await ensureEntityBindings(dealId);
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 },
    );
  }
}
