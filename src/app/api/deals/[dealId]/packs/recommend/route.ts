// src/app/api/deals/[dealId]/packs/recommend/route.ts
import { NextResponse } from "next/server";
import { getPackRecommendation } from "@/lib/packs/getPackRecommendation";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { clerkAuth } from "@/lib/auth/clerkServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  try {
    const { userId } = await clerkAuth();
    if (!userId) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      const status = access.error === "unauthorized" ? 401 : 404;
      return NextResponse.json({ ok: false, error: access.error }, { status });
    }

    const recommendation = await getPackRecommendation(dealId);

    if (!recommendation) {
      return NextResponse.json({
        ok: true,
        recommendation: null,
        message: "No suitable pack found",
      });
    }

    return NextResponse.json({ ok: true, recommendation });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    return NextResponse.json(
      { ok: false, error: msg || "recommendation_failed" },
      { status: 500 },
    );
  }
}
