import "server-only";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/requireRole";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { buildDealFinancialSnapshotForBank } from "@/lib/deals/financialSnapshot";
import { computeFinancialStress, type LoanTerms } from "@/lib/deals/financialStressEngine";
import { evaluateSbaEligibility } from "@/lib/sba/eligibilityEngine";
import { buildNarrative } from "@/lib/creditMemo/narrative/buildNarrative";
import { persistFinancialSnapshot, persistFinancialSnapshotDecision } from "@/lib/deals/financialSnapshotPersistence";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

async function loadDealMeta(dealId: string) {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("deals")
    .select("id, bank_id, entity_type, deal_type")
    .eq("id", dealId)
    .maybeSingle();
  return data ?? null;
}

async function loadLoanTermsAndMeta(dealId: string): Promise<{
  loanTerms: LoanTerms;
  loanProductType: string | null;
  useOfProceeds: string[] | null;
}> {
  const sb = supabaseAdmin();

  const { data: underwrite } = await sb
    .from("deal_underwrite_inputs")
    .select(
      "proposed_amount, proposed_amort_months, proposed_interest_only_months, proposed_product_type, pricing_floor_rate, created_at",
    )
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: request } = await sb
    .from("deal_loan_requests")
    .select(
      "requested_amount, requested_amort_months, requested_interest_only_months, product_type, use_of_proceeds, created_at",
    )
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const principal = (underwrite as any)?.proposed_amount ?? (request as any)?.requested_amount ?? null;
  const amortMonths = (underwrite as any)?.proposed_amort_months ?? (request as any)?.requested_amort_months ?? null;
  const ioMonths =
    (underwrite as any)?.proposed_interest_only_months ?? (request as any)?.requested_interest_only_months ?? null;
  const rate = (underwrite as any)?.pricing_floor_rate ?? null;

  const loanTerms: LoanTerms = {
    principal: typeof principal === "number" ? principal : null,
    amortMonths: typeof amortMonths === "number" ? amortMonths : null,
    interestOnly: typeof ioMonths === "number" ? ioMonths > 0 : false,
    rate: typeof rate === "number" ? rate : null,
  };

  const loanProductType =
    (underwrite as any)?.proposed_product_type ?? (request as any)?.product_type ?? null;
  const useOfProceedsRaw = (request as any)?.use_of_proceeds ?? null;
  const useOfProceeds = Array.isArray(useOfProceedsRaw) ? useOfProceedsRaw : null;

  return { loanTerms, loanProductType, useOfProceeds };
}

export async function POST(_req: Request, ctx: Ctx) {
  try {
    await requireRole(["super_admin", "bank_admin", "underwriter"]);
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    // Pre-flight: ensure financial facts exist before building a snapshot.
    const sb = supabaseAdmin();
    const { count: factsCount } = await (sb as any)
      .from("deal_financial_facts")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .eq("bank_id", access.bankId);

    if (!factsCount || factsCount === 0) {
      const { data: pendingJobs } = await (sb as any)
        .from("deal_spread_jobs")
        .select("id, status")
        .eq("deal_id", dealId)
        .eq("bank_id", access.bankId)
        .in("status", ["QUEUED", "RUNNING"])
        .limit(1);

      if (pendingJobs && pendingJobs.length > 0) {
        return NextResponse.json({
          ok: false,
          error: "spreads_in_progress",
          message: "Financial spreads are currently generating. Please wait and try again.",
        }, { status: 409 });
      }

      return NextResponse.json({
        ok: false,
        error: "no_financial_facts",
        message: "No financial data has been extracted yet. Upload and classify financial documents first, then run Recompute Spreads.",
      }, { status: 422 });
    }

    const [snapshot, dealMeta, loanMeta] = await Promise.all([
      buildDealFinancialSnapshotForBank({ dealId, bankId: access.bankId }),
      loadDealMeta(dealId),
      loadLoanTermsAndMeta(dealId),
    ]);

    const stress = computeFinancialStress({
      snapshot,
      loanTerms: loanMeta.loanTerms,
      stress: { vacancyUpPct: 0.1, rentDownPct: 0.1, rateUpBps: 200 },
    });

    const sba = evaluateSbaEligibility({
      snapshot,
      borrowerEntityType: (dealMeta as any)?.entity_type ?? null,
      useOfProceeds: loanMeta.useOfProceeds,
      dealType: (dealMeta as any)?.deal_type ?? null,
      loanProductType: loanMeta.loanProductType,
    });

    const narrative = await buildNarrative({
      dealId,
      snapshot,
      stress,
      sba,
    });

    const snapRow = await persistFinancialSnapshot({
      dealId,
      bankId: access.bankId,
      snapshot,
      asOfTimestamp: new Date().toISOString(),
    });

    const decisionRow = await persistFinancialSnapshotDecision({
      snapshotId: snapRow.id,
      dealId,
      bankId: access.bankId,
      inputs: {
        loanTerms: loanMeta.loanTerms,
        loanProductType: loanMeta.loanProductType,
        useOfProceeds: loanMeta.useOfProceeds,
        entityType: (dealMeta as any)?.entity_type ?? null,
        dealType: (dealMeta as any)?.deal_type ?? null,
      },
      stress,
      sba,
      narrative,
    });

    await logLedgerEvent({
      dealId,
      bankId: access.bankId,
      eventKey: "financial_snapshot_recomputed",
      uiState: "done",
      uiMessage: "Financial snapshot recomputed",
      meta: { snapshotId: snapRow.id, decisionId: decisionRow.id },
    });

    return NextResponse.json({
      ok: true,
      dealId,
      snapshotId: snapRow.id,
      decisionId: decisionRow.id,
      snapshot,
      stress,
      sba,
      narrative,
    });
  } catch (e: any) {
    console.error("[/api/deals/[dealId]/financial-snapshot/recompute]", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "unexpected_error" }, { status: 500 });
  }
}
