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

    // Fallback: if entity DSCR is null (ADS not in deal_financial_facts),
    // compute directly from deal_structural_pricing + latest EBITDA/NCADS fact.
    if (entityDscr === null) {
      try {
        const sb = (await import("@/lib/supabase/admin")).supabaseAdmin();

        const { data: pricingRow } = await (sb as any)
          .from("deal_structural_pricing")
          .select("annual_debt_service_est")
          .eq("deal_id", dealId)
          .order("computed_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const ads = pricingRow?.annual_debt_service_est
          ? Number(pricingRow.annual_debt_service_est)
          : null;

        if (ads !== null && ads > 0) {
          const { data: factRows } = await (sb as any)
            .from("deal_financial_facts")
            .select("fact_key, fact_value_num, fact_period_end")
            .eq("deal_id", dealId)
            .in("fact_key", ["ORDINARY_BUSINESS_INCOME", "NET_INCOME", "EBITDA"])
            .not("fact_value_num", "is", null)
            .order("fact_period_end", { ascending: false })
            .limit(10);

          if (factRows && factRows.length > 0) {
            const latest = factRows[0];
            const latestPeriod = latest.fact_period_end;
            const periodFacts = (factRows as any[]).filter(
              (r) => r.fact_period_end === latestPeriod,
            );
            const ncads =
              periodFacts.find((r: any) => r.fact_key === "EBITDA")?.fact_value_num ??
              periodFacts.find((r: any) => r.fact_key === "ORDINARY_BUSINESS_INCOME")?.fact_value_num ??
              periodFacts.find((r: any) => r.fact_key === "NET_INCOME")?.fact_value_num ??
              null;

            if (ncads !== null && isFinite(Number(ncads))) {
              entityDscr = Math.round((Number(ncads) / ads) * 100) / 100;
            }
          }
        }
      } catch (fallbackErr: any) {
        console.warn("[spread-intelligence] Entity DSCR fallback failed (non-fatal)", fallbackErr?.message);
      }
    }

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
