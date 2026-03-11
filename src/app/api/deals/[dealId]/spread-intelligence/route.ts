import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { loadClassicSpreadData } from "@/lib/classicSpread/classicSpreadLoader";
import { reconcileDscr } from "@/lib/financialIntelligence/dscrReconciliation";
import { computeSpreadCompleteness } from "@/lib/financialIntelligence/spreadCompletenessScore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * GET /api/deals/[dealId]/spread-intelligence
 *
 * Returns DSCR reconciliation and spread completeness scoring.
 * All computation is pure — the only DB call is loadClassicSpreadData().
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      const status = access.error === "deal_not_found" ? 404 : 403;
      return NextResponse.json(
        { ok: false, error: access.error },
        { status },
      );
    }

    const spreadData = await loadClassicSpreadData(dealId);

    // ── Extract DSCR values from spread data ──────────────────────────────

    // Entity DSCR from ratio sections
    let entityDscr: number | null = null;
    let ucaDscr: number | null = null;
    for (const section of spreadData.ratioSections) {
      for (const row of section.rows) {
        const key = row.label.toLowerCase().trim();
        if (key === "dscr" || key === "debt service coverage") {
          const lastVal = [...row.values].reverse().find((v) => v != null && typeof v === "number");
          if (lastVal != null) entityDscr = lastVal as number;
        }
        if (key === "uca cfo dscr" || key === "uca dscr") {
          const lastVal = [...row.values].reverse().find((v) => v != null && typeof v === "number");
          if (lastVal != null) ucaDscr = lastVal as number;
        }
      }
    }

    // Global DSCR from globalCashFlow section
    const globalDscr = spreadData.globalCashFlow?.globalDscr ?? null;
    const entityCashFlowAvailable = spreadData.globalCashFlow?.entityCashFlowAvailable ?? null;
    const globalCashFlow = spreadData.globalCashFlow?.globalCashFlow ?? null;
    const proposedAds = spreadData.globalCashFlow?.proposedAnnualDebtService ?? null;
    const sponsorCount = spreadData.globalCashFlow?.sponsors?.length ?? 0;
    const entityCount = spreadData.globalCashFlow?.entityCount ?? 0;

    // UCA Cash From Operations — find from cash flow rows
    let ucaCashFromOperations: number | null = null;
    for (const row of spreadData.cashFlow) {
      const key = row.label.toLowerCase().trim();
      if (key === "cash from operations" || key === "total cash from operations") {
        const lastVal = [...row.values].reverse().find((v) => v != null);
        if (lastVal != null) ucaCashFromOperations = lastVal;
      }
    }

    // ── Run pure computations ─────────────────────────────────────────────

    const dscr = reconcileDscr({
      entityDscr,
      ucaDscr,
      globalDscr,
      entityCashFlowAvailable,
      ucaCashFromOperations,
      globalCashFlow,
      proposedAds,
      sponsorCount,
      entityCount,
    });

    const completeness = computeSpreadCompleteness(spreadData);

    return NextResponse.json({
      ok: true,
      dscr,
      completeness,
    });
  } catch (error: any) {
    console.error("[spread-intelligence] error", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Internal server error" },
      { status: 500 },
    );
  }
}
