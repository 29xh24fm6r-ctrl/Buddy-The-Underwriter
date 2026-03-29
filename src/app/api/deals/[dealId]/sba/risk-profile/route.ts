import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { computeSBARiskProfile } from "@/lib/sba/sbaRiskProfile";
import {
  evaluateNewBusinessProtocol,
  computeBusinessAgeMonths,
} from "@/lib/sba/newBusinessProtocol";

export const runtime = "nodejs";

type Params = Promise<{ dealId: string }>;

const SBA_TYPES = ["SBA", "sba_7a", "sba_504", "sba_express"];

async function ensureSbaDealOrReturn403(
  dealId: string,
): Promise<Response | null> {
  const sb = supabaseAdmin();
  const { data: deal } = await sb
    .from("deals")
    .select("deal_type")
    .eq("id", dealId)
    .single();
  if (!deal || !SBA_TYPES.includes(deal.deal_type ?? "")) {
    return NextResponse.json(
      { error: "SBA risk profile is not available for this deal type." },
      { status: 403 },
    );
  }
  return null;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Params },
) {
  try {
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: 403 },
      );
    }

    const sbaGate = await ensureSbaDealOrReturn403(dealId);
    if (sbaGate) return sbaGate;

    const sb = supabaseAdmin();

    // 1. Load deal info
    const { data: deal } = await sb
      .from("deals")
      .select("id, naics_code, loan_amount, deal_type")
      .eq("id", dealId)
      .single();

    // 2. Load deal intake for business establishment date
    const { data: intake } = await sb
      .from("deal_intake")
      .select("business_established_date, business_age_months, is_urban")
      .eq("deal_id", dealId)
      .maybeSingle();

    // 3. Load loan structure for term
    const { data: structureSection } = await sb
      .from("deal_builder_sections")
      .select("data")
      .eq("deal_id", dealId)
      .eq("section_key", "structure")
      .maybeSingle();

    // 4. Load SBA benchmark data for this NAICS
    const naicsCode = (deal as any)?.naics_code ?? null;
    let sbaDefaultRate5yr: number | null = null;
    let sbaDefaultRate10yr: number | null = null;

    if (naicsCode) {
      const { data: benchmark } = await sb
        .from("buddy_industry_benchmarks")
        .select(
          "sba_default_rate_5yr, sba_default_rate_10yr",
        )
        .eq("naics_code", naicsCode)
        .limit(1)
        .maybeSingle();

      sbaDefaultRate5yr = benchmark?.sba_default_rate_5yr ?? null;
      sbaDefaultRate10yr = benchmark?.sba_default_rate_10yr ?? null;
    }

    // 5. Check if deal has historical financials and projections
    const { count: factCount } = await sb
      .from("deal_financial_facts")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId);

    const { count: packageCount } = await sb
      .from("buddy_sba_packages")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId);

    // Resolve inputs
    const structure = structureSection?.data as
      | Record<string, unknown>
      | null;
    const termMonths =
      (structure?.desired_term_months as number | undefined) ?? null;
    const businessAgeMonths =
      (intake as any)?.business_age_months ??
      computeBusinessAgeMonths(
        (intake as any)?.business_established_date ?? null,
      );
    const isUrban = (intake as any)?.is_urban ?? null;

    // 6. Compute new business protocol
    const newBusinessResult = evaluateNewBusinessProtocol({
      businessAgeMonths,
      businessEstablishedDate:
        (intake as any)?.business_established_date ?? null,
      hasHistoricalFinancials: (factCount ?? 0) > 0,
      hasProjections: (packageCount ?? 0) > 0,
      naicsCode,
    });

    // 7. Compute risk profile
    const riskProfile = computeSBARiskProfile({
      naicsCode,
      sbaDefaultRate5yr: sbaDefaultRate5yr,
      sbaDefaultRate10yr: sbaDefaultRate10yr,
      businessAgeMonths,
      loanTermMonths: termMonths,
      isUrban,
    });

    // 8. Persist to buddy_sba_risk_profiles
    await sb.from("buddy_sba_risk_profiles").insert({
      deal_id: dealId,
      naics_code: naicsCode,
      business_age_months: businessAgeMonths,
      is_new_business: newBusinessResult.isNewBusiness,
      loan_term_months: termMonths,
      is_urban: isUrban,
      industry_score: riskProfile.industryScore,
      business_age_score: riskProfile.businessAgeScore,
      loan_term_score: riskProfile.loanTermScore,
      location_score: riskProfile.locationScore,
      composite_score: riskProfile.compositeScore,
      risk_tier: riskProfile.riskTier,
      dscr_threshold_applied: newBusinessResult.dscrThreshold,
      new_business_flags: newBusinessResult.flags,
      engine_version: "sba_risk_v1",
    });

    return NextResponse.json({
      ok: true,
      riskProfile,
      newBusiness: newBusinessResult,
      naicsCode,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
