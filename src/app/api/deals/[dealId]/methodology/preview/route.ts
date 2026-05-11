import "server-only";

import { NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";
import { loadDealMethodology } from "@/lib/methodology/loadDealMethodology";
import {
  METHODOLOGY_AXES,
  ALL_METHODOLOGY_AXIS_IDS,
} from "@/lib/methodology/methodologyAxes";
import { projectDscrForVariant } from "@/lib/methodology/projectDscrForVariant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Ctx = { params: Promise<{ dealId: string }> };

const FACT_KEYS_FOR_PROJECTION = [
  "ORDINARY_BUSINESS_INCOME",
  "INTEREST_EXPENSE",
  "DEPRECIATION",
  "AMORTIZATION",
  "SECTION_179_EXPENSE",
  "BONUS_DEPRECIATION",
  "NON_RECURRING_EXPENSE",
  "NON_RECURRING_INCOME",
  "GUARANTEED_PAYMENTS",
  "COST_OF_GOODS_SOLD",
  "OFFICER_COMPENSATION",
  "GROSS_RECEIPTS",
  "NET_INCOME",
];

/**
 * SPEC-B4.1.3 — Preview the DSCR impact of each variant on each axis.
 *
 * Pure-read endpoint. No DB writes, no recompute trigger, no methodology
 * choice persisted.
 */
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    const bankId = (access as any).bankId as string;

    const sb = supabaseAdmin();
    const { slate: currentSlate } = await loadDealMethodology(dealId, bankId);

    // Read proposed ADS
    const { data: pricingRow } = await (sb as any)
      .from("deal_structural_pricing")
      .select("annual_debt_service_est")
      .eq("deal_id", dealId)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const proposedAds = pricingRow?.annual_debt_service_est
      ? Number(pricingRow.annual_debt_service_est)
      : null;

    if (proposedAds === null || !(proposedAds > 0)) {
      return NextResponse.json(
        {
          ok: true,
          projectable: false,
          reason: "No proposed annual debt service set. Projection requires loan terms.",
        },
        { status: 200 },
      );
    }

    // Read tax-return-derived facts (latest period)
    const { data: factRows } = await (sb as any)
      .from("deal_financial_facts")
      .select("fact_key, fact_value_num, fact_period_end")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .eq("is_superseded", false)
      .neq("resolution_status", "rejected")
      .in("fact_key", FACT_KEYS_FOR_PROJECTION)
      .order("fact_period_end", { ascending: false });

    if (!factRows || factRows.length === 0) {
      return NextResponse.json(
        {
          ok: true,
          projectable: false,
          reason: "No tax-return facts yet. Upload tax returns to enable projection.",
        },
        { status: 200 },
      );
    }

    // Build fact map from latest period
    const latestPeriod = (factRows as any[])[0].fact_period_end;
    const latestFacts = (factRows as any[]).filter(
      (r: any) => r.fact_period_end === latestPeriod,
    );
    const facts: Record<string, number | null> = {};
    for (const k of FACT_KEYS_FOR_PROJECTION) {
      const row = latestFacts.find((r: any) => r.fact_key === k);
      facts[k] = row?.fact_value_num ?? null;
    }

    const formType = facts.GUARANTEED_PAYMENTS !== null ? "FORM_1065" : "FORM_1120";

    // Project current slate (baseline)
    const currentProjection = projectDscrForVariant({
      facts,
      formType,
      currentSlate,
      override: null,
      proposedAds,
    });

    const currentDscr = currentProjection.projectedDscr;

    // Project each axis × variant
    const axisResults: Record<string, any> = {};

    for (const axisId of ALL_METHODOLOGY_AXIS_IDS) {
      const axis = METHODOLOGY_AXES[axisId];
      const currentVariant = currentSlate[axisId];

      const variantResults = axis.variants.map((variant) => {
        const isCurrent = variant.id === currentVariant;
        const projection = isCurrent
          ? currentProjection
          : projectDscrForVariant({
              facts,
              formType,
              currentSlate,
              override: { axis: axisId, variant: variant.id },
              proposedAds,
            });

        const deltaDscr =
          projection.projectedDscr !== null && currentDscr !== null
            ? Math.round((projection.projectedDscr - currentDscr) * 100) / 100
            : null;

        return {
          variantId: variant.id,
          isCurrent,
          projectedDscr: projection.projectedDscr,
          projectedNcads: projection.projectedNcads,
          deltaDscr: isCurrent ? 0 : deltaDscr,
        };
      });

      axisResults[axisId] = {
        currentVariant,
        variants: variantResults,
      };
    }

    return NextResponse.json(
      {
        ok: true,
        projectable: true,
        currentDscr,
        currentNcads: currentProjection.projectedNcads,
        proposedAds,
        formType,
        axes: axisResults,
      },
      { status: 200 },
    );
  } catch (err) {
    rethrowNextErrors(err);
    console.error("[methodology/preview GET] error", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
