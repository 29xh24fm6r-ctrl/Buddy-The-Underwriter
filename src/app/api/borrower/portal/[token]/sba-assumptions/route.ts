// src/app/api/borrower/portal/[token]/sba-assumptions/route.ts
// Phase 85-BPG-A — Portal-token-gated SBA assumptions read/write.
//
// Mirrors the banker-facing /api/deals/[dealId]/sba/assumptions route but
// uses resolvePortalContext() instead of ensureDealBankAccess (no Clerk).
// The borrower's intake AssumptionInterview component calls GET/PATCH here.

import { NextRequest, NextResponse } from "next/server";
import { resolvePortalContext } from "@/lib/borrower/resolvePortalContext";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadSBAAssumptionsPrefill } from "@/lib/sba/sbaAssumptionsPrefill";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

type Params = Promise<{ token: string }>;

// ─── GET — Load existing assumptions + prefilled defaults ─────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Params },
) {
  const { token } = await params;

  let ctx: { dealId: string; bankId: string };
  try {
    ctx = await resolvePortalContext(token);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid token" },
      { status: 401 },
    );
  }

  const sb = supabaseAdmin();

  const { data: row } = await sb
    .from("buddy_sba_assumptions")
    .select("*")
    .eq("deal_id", ctx.dealId)
    .maybeSingle();

  const prefilled = await loadSBAAssumptionsPrefill(ctx.dealId);

  // Pre-populate management team from intake owners (Phase 85A.2) if no
  // management team has landed yet in either existing assumptions or
  // loadSBAAssumptionsPrefill.
  const { data: ownerSection } = await sb
    .from("deal_builder_sections")
    .select("data")
    .eq("deal_id", ctx.dealId)
    .eq("section_key", "owners")
    .maybeSingle();

  const intakeOwners =
    ((ownerSection?.data as { owners?: unknown[] } | null)?.owners as
      | Array<Record<string, string>>
      | undefined) ?? [];

  const existingHasTeam =
    Array.isArray(row?.management_team) && row!.management_team.length > 0;
  const prefillHasTeam =
    Array.isArray(prefilled.managementTeam) &&
    prefilled.managementTeam.length > 0;

  if (!existingHasTeam && !prefillHasTeam && intakeOwners.length > 0) {
    prefilled.managementTeam = intakeOwners.map((o) => {
      const pct = o.ownership_pct ? parseFloat(o.ownership_pct) : undefined;
      const years = o.years_in_industry ? parseInt(o.years_in_industry, 10) : 0;
      return {
        name: o.full_name || "",
        title: o.title || "Owner",
        ownershipPct: Number.isFinite(pct as number) ? pct : undefined,
        yearsInIndustry: Number.isFinite(years) ? years : 0,
        bio: "",
      };
    });
  }

  // Enrich loanImpact with intake loan data (amount from Step 4 wins over
  // prefill's deal.loan_amount read when the borrower edited it).
  const { data: loanSection } = await sb
    .from("deal_builder_sections")
    .select("data")
    .eq("deal_id", ctx.dealId)
    .eq("section_key", "loan")
    .maybeSingle();

  if (loanSection?.data) {
    const loanData = loanSection.data as { amount?: string | number };
    const rawAmount =
      typeof loanData.amount === "number"
        ? loanData.amount
        : typeof loanData.amount === "string"
          ? parseFloat(loanData.amount.replace(/[^0-9.]/g, ""))
          : NaN;

    if (Number.isFinite(rawAmount) && rawAmount > 0) {
      const existingLoanAmount = prefilled.loanImpact?.loanAmount ?? 0;
      if (existingLoanAmount === 0) {
        prefilled.loanImpact = {
          loanAmount: rawAmount,
          termMonths: prefilled.loanImpact?.termMonths ?? 120,
          interestRate: prefilled.loanImpact?.interestRate ?? 0.0725,
          existingDebt: prefilled.loanImpact?.existingDebt ?? [],
          equityInjectionAmount:
            prefilled.loanImpact?.equityInjectionAmount ?? 0,
          equityInjectionSource:
            prefilled.loanImpact?.equityInjectionSource ?? "cash_savings",
          sellerFinancingAmount:
            prefilled.loanImpact?.sellerFinancingAmount ?? 0,
          sellerFinancingTermMonths:
            prefilled.loanImpact?.sellerFinancingTermMonths ?? 0,
          sellerFinancingRate: prefilled.loanImpact?.sellerFinancingRate ?? 0,
          otherSources: prefilled.loanImpact?.otherSources ?? [],
        };
      }
    }
  }

  const assumptions = row
    ? {
        dealId: ctx.dealId,
        status: row.status,
        confirmedAt: row.confirmed_at ?? undefined,
        revenueStreams: row.revenue_streams,
        costAssumptions: row.cost_assumptions,
        workingCapital: row.working_capital,
        loanImpact: row.loan_impact,
        managementTeam: row.management_team,
      }
    : null;

  return NextResponse.json({ ok: true, assumptions, prefilled });
}

// ─── PATCH — Save assumption updates (section-at-a-time) ──────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Params },
) {
  const { token } = await params;

  let ctx: { dealId: string; bankId: string };
  try {
    ctx = await resolvePortalContext(token);
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid token" },
      { status: 401 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const patch = (body?.patch ?? {}) as Record<string, unknown>;

  const sb = supabaseAdmin();

  const upsertData: Record<string, unknown> = {
    deal_id: ctx.dealId,
    updated_at: new Date().toISOString(),
  };

  if (patch.revenueStreams !== undefined)
    upsertData.revenue_streams = patch.revenueStreams;
  if (patch.costAssumptions !== undefined)
    upsertData.cost_assumptions = patch.costAssumptions;
  if (patch.workingCapital !== undefined)
    upsertData.working_capital = patch.workingCapital;
  if (patch.loanImpact !== undefined)
    upsertData.loan_impact = patch.loanImpact;
  if (patch.managementTeam !== undefined)
    upsertData.management_team = patch.managementTeam;
  if (patch.status !== undefined) {
    upsertData.status = patch.status;
    if (patch.status === "confirmed") {
      upsertData.confirmed_at = new Date().toISOString();
    }
  }

  const { error } = await sb
    .from("buddy_sba_assumptions")
    .upsert(upsertData, { onConflict: "deal_id" });

  if (error) {
    console.error(
      "[sba-assumptions] upsert error:",
      error.code,
      error.details,
      error.hint,
    );
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
