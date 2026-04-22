import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { buildSBARiskProfile } from "@/lib/sba/sbaRiskProfile";
import type { UrbanRuralClassification } from "@/lib/sba/sbaRiskProfile";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;

type Params = Promise<{ dealId: string }>;

const SBA_TYPES = ["SBA", "sba_7a", "sba_504", "sba_express"];

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

    const sb = supabaseAdmin();

    const { data: deal } = await sb
      .from("deals")
      .select("id, name, deal_type, loan_amount")
      .eq("id", dealId)
      .single();

    if (!deal || !SBA_TYPES.includes(deal.deal_type ?? "")) {
      return NextResponse.json(
        { error: "SBA risk profile is only available for SBA loan types." },
        { status: 403 },
      );
    }

    const { data: facts } = await sb
      .from("deal_financial_facts")
      .select("fact_key, value_numeric, value_text")
      .eq("deal_id", dealId)
      .in("fact_key", [
        "YEARS_IN_BUSINESS",
        "MONTHS_IN_BUSINESS",
        "BUSINESS_DATE_FORMED",
        "DATE_FORMED",
        "NAICS_CODE",
      ]);

    const { data: businessSection } = await sb
      .from("deal_builder_sections")
      .select("data")
      .eq("deal_id", dealId)
      .eq("section_key", "business")
      .maybeSingle();

    const { data: structureSection } = await sb
      .from("deal_builder_sections")
      .select("data")
      .eq("deal_id", dealId)
      .eq("section_key", "structure")
      .maybeSingle();

    const { data: assumptionsRow } = await sb
      .from("buddy_sba_assumptions")
      .select("management_team")
      .eq("deal_id", dealId)
      .maybeSingle();

    const business =
      ((businessSection?.data as Record<string, unknown>) ?? {});
    const structure =
      ((structureSection?.data as Record<string, unknown>) ?? {});

    const naicsFromFact = (facts ?? []).find(
      (f) => f.fact_key === "NAICS_CODE",
    )?.value_text;
    const naicsCode =
      naicsFromFact ?? (business.naics_code as string | null) ?? null;
    const termMonths =
      (structure.desired_term_months as number | null) ??
      (structure.term_months as number | null) ??
      null;

    const managementTeam =
      (assumptionsRow?.management_team as Array<{
        yearsInIndustry?: number;
      }> | null) ?? [];
    const managementYearsInIndustry =
      managementTeam.length > 0
        ? Math.max(...managementTeam.map((m) => m.yearsInIndustry ?? 0))
        : null;

    const profile = await buildSBARiskProfile({
      dealId,
      loanType: deal.deal_type ?? "SBA",
      naicsCode,
      termMonths,
      urbanRural: "unknown" as UrbanRuralClassification,
      state: (business.state as string | null) ?? null,
      zip: (business.zip as string | null) ?? null,
      facts: facts ?? [],
      managementYearsInIndustry,
      hasBusinessPlan: !!assumptionsRow?.management_team,
      sb,
    });

    return NextResponse.json({ profile });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
