import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * This route previously called a stub (runMemoResearch) that returned
 * hardcoded placeholder text wrapped in { ok: true } — indistinguishable
 * from real research that legitimately found nothing, and reachable with
 * no auth check at all. See specs/audits/RESEARCH_SYSTEM_FULL_AUDIT.md P0-6.
 *
 * It now (a) requires the caller's bank to own the deal, and (b) returns an
 * honest not_implemented error instead of fabricated content. The real
 * research pipeline is POST /api/deals/[dealId]/research/run — memo UIs
 * that want research should read it back via loadResearchForMemo, not this
 * route.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await ctx.params;
  if (!dealId) {
    return NextResponse.json(
      { ok: false, error: "Missing dealId" },
      { status: 400 },
    );
  }

  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    const status = access.error === "deal_not_found" ? 404 : access.error === "unauthorized" ? 401 : 403;
    return NextResponse.json({ ok: false, error: access.error }, { status });
  }

  return NextResponse.json(
    {
      ok: false,
      error: "not_implemented",
      message:
        "This endpoint is not implemented. Use POST /api/deals/[dealId]/research/run " +
        "to trigger real institutional research, then read it back via the credit memo's " +
        "business_industry_analysis / research sections.",
    },
    { status: 501 },
  );
}
