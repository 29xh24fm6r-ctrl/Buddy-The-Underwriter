import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { persistGlobalCashFlow } from "@/lib/financialIntelligence/persistGlobalCashFlow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const gcf = await persistGlobalCashFlow({
      dealId,
      bankId: access.bankId,
    });

    if (!gcf.ok) {
      return NextResponse.json(
        { ok: false, error: gcf.error },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      dealId,
      factsWritten: gcf.factsWritten,
      globalCashFlowAvailable: gcf.result.globalCashFlowAvailable,
      globalDscr: gcf.result.globalDscr,
      entityCount: gcf.result.entities.length,
      sponsorCount: gcf.result.sponsors.length,
      warnings: gcf.result.warnings,
      notes: gcf.notes,
    });
  } catch (e: any) {
    console.error("[/api/deals/[dealId]/gcf]", e);
    return NextResponse.json(
      { ok: false, error: "unexpected_error" },
      { status: 500 },
    );
  }
}
