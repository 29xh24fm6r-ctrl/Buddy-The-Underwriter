import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { computeEtranReadiness } from "@/lib/sba/sbaEtranReadiness";
import type { EtranReadinessInput } from "@/lib/sba/sbaEtranReadiness";

export const runtime = "nodejs";

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

    // Gate: SBA deals only
    const { data: deal } = await sb
      .from("deals")
      .select("id, deal_type, loan_amount")
      .eq("id", dealId)
      .single();

    if (!deal || !SBA_TYPES.includes(deal.deal_type ?? "")) {
      return NextResponse.json(
        { error: "E-Tran readiness is only available for SBA loan types." },
        { status: 403 },
      );
    }

    // Load builder sections (sequential queries)
    const { data: businessSection } = await sb
      .from("deal_builder_sections")
      .select("data")
      .eq("deal_id", dealId)
      .eq("section_key", "business")
      .maybeSingle();

    const { data: partiesSection } = await sb
      .from("deal_builder_sections")
      .select("data")
      .eq("deal_id", dealId)
      .eq("section_key", "parties")
      .maybeSingle();

    const { data: guarantorsSection } = await sb
      .from("deal_builder_sections")
      .select("data")
      .eq("deal_id", dealId)
      .eq("section_key", "guarantors")
      .maybeSingle();

    const { data: structureSection } = await sb
      .from("deal_builder_sections")
      .select("data")
      .eq("deal_id", dealId)
      .eq("section_key", "structure")
      .maybeSingle();

    const { data: storySection } = await sb
      .from("deal_builder_sections")
      .select("data")
      .eq("deal_id", dealId)
      .eq("section_key", "story")
      .maybeSingle();

    // Load proceeds
    const { data: proceedsItems } = await sb
      .from("deal_proceeds_items")
      .select("amount")
      .eq("deal_id", dealId);

    // Load collateral count
    const { count: collateralCount } = await sb
      .from("deal_collateral_items")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId);

    // Load gross revenue from financial facts
    const { data: revFact } = await sb
      .from("deal_financial_facts")
      .select("value_numeric")
      .eq("deal_id", dealId)
      .eq("fact_key", "TOTAL_REVENUE_IS")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Load SBA assumptions status
    const { data: assumptionsRow } = await sb
      .from("buddy_sba_assumptions")
      .select("status")
      .eq("deal_id", dealId)
      .maybeSingle();

    // Shape data
    const business =
      ((businessSection?.data as Record<string, unknown>) ?? {});
    const parties =
      ((partiesSection?.data as Record<string, unknown>) ?? {});
    const guarantors =
      ((guarantorsSection?.data as Record<string, unknown>) ?? {});
    const structure =
      ((structureSection?.data as Record<string, unknown>) ?? {});
    const story =
      ((storySection?.data as Record<string, unknown>) ?? {});

    const owners = ((parties.owners as unknown[]) ?? []) as Array<
      Record<string, unknown>
    >;
    const guarantorsList = ((guarantors.guarantors as unknown[]) ??
      []) as Array<Record<string, unknown>>;

    const proceedsTotal = (proceedsItems ?? []).reduce(
      (s, i) => s + ((i as any).amount ?? 0),
      0,
    );

    const input: EtranReadinessInput = {
      dealId,
      loanAmount: (deal as any).loan_amount ?? null,
      dealType: deal.deal_type ?? null,
      business: {
        legalEntityName:
          (business.legal_entity_name as string | null) ?? null,
        ein: (business.ein as string | null) ?? null,
        entityType: (business.entity_type as string | null) ?? null,
        businessAddress:
          (business.business_address as string | null) ?? null,
        city: (business.city as string | null) ?? null,
        state: (business.state as string | null) ?? null,
        zip: (business.zip as string | null) ?? null,
        naicsCode: (business.naics_code as string | null) ?? null,
        dateFormed: (business.date_formed as string | null) ?? null,
        employeeCount:
          (business.employee_count as number | null) ?? null,
      },
      owners: owners.map((o) => ({
        fullLegalName:
          (o.full_legal_name as string | null) ?? null,
        ownershipPct:
          (o.ownership_pct as number | null) ?? null,
        ssn_last4: (o.ssn_last4 as string | null) ?? null,
        homeAddress: (o.home_address as string | null) ?? null,
        homeCity: (o.home_city as string | null) ?? null,
        homeState: (o.home_state as string | null) ?? null,
        homeZip: (o.home_zip as string | null) ?? null,
      })),
      guarantors: guarantorsList.map((g) => ({
        fullLegalName:
          (g.full_legal_name as string | null) ?? null,
        ssn_last4: (g.ssn_last4 as string | null) ?? null,
        guarantyType:
          (g.guaranty_type as string | null) ?? null,
      })),
      noGuarantors: !!guarantors.no_guarantors,
      structure: {
        loanPurpose:
          (structure.loan_purpose as string | null) ?? null,
        desiredTermMonths:
          (structure.desired_term_months as number | null) ?? null,
        equityInjectionAmount:
          (structure.equity_injection_amount as number | null) ?? null,
        equityInjectionSource:
          (structure.equity_injection_source as string | null) ?? null,
      },
      proceedsTotal,
      proceedsLineCount: proceedsItems?.length ?? 0,
      collateralItemCount: collateralCount ?? 0,
      story: {
        loanPurposeNarrative:
          (story.loan_purpose_narrative as string | null) ?? null,
        managementQualifications:
          (story.management_qualifications as string | null) ?? null,
      },
      grossAnnualRevenue: revFact?.value_numeric ?? null,
      hasSbaAssumptions: !!assumptionsRow,
      hasConfirmedAssumptions:
        assumptionsRow?.status === "confirmed",
    };

    const report = computeEtranReadiness(input);
    return NextResponse.json({ report });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
