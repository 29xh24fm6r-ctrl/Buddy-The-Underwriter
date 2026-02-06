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
import { getVisibleFacts } from "@/lib/financialFacts/getVisibleFacts";

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

    // Telemetry: snapshot run started
    logLedgerEvent({
      dealId,
      bankId: access.bankId,
      eventKey: "snapshot.run.started",
      uiState: "working",
      uiMessage: "Snapshot generation started",
    }).catch(() => {});

    // Pre-flight: canonical facts visibility check
    const sb = supabaseAdmin();
    const factsVis = await getVisibleFacts(dealId, access.bankId);

    // Telemetry: facts visible count
    logLedgerEvent({
      dealId,
      bankId: access.bankId,
      eventKey: "facts.visible.count",
      uiState: factsVis.total > 0 ? "done" : "waiting",
      uiMessage: `${factsVis.total} financial facts visible`,
      meta: {
        facts_count: factsVis.total,
        by_owner_type: factsVis.byOwnerType,
        by_fact_type: factsVis.byFactType,
      },
    }).catch(() => {});

    if (factsVis.total === 0) {
      // Check for pending spread jobs
      const { data: pendingJobs } = await (sb as any)
        .from("deal_spread_jobs")
        .select("id, status")
        .eq("deal_id", dealId)
        .eq("bank_id", access.bankId)
        .in("status", ["QUEUED", "RUNNING"])
        .limit(1);

      // Also check spreads summary for structured response
      const { data: spreadRows } = await (sb as any)
        .from("deal_spreads")
        .select("spread_type, status")
        .eq("deal_id", dealId)
        .eq("bank_id", access.bankId);

      const spreads = (spreadRows ?? []) as Array<{ spread_type: string; status: string }>;
      const spreadsReady = spreads.filter((s) => s.status === "ready").length;
      const spreadsGenerating = spreads.filter((s) => s.status === "generating").length;
      const spreadsError = spreads.filter((s) => s.status === "error").length;

      if ((pendingJobs && pendingJobs.length > 0) || spreadsGenerating > 0) {
        logLedgerEvent({
          dealId,
          bankId: access.bankId,
          eventKey: "snapshot.run.failed",
          uiState: "error",
          uiMessage: "Snapshot blocked: spreads still generating",
          meta: { reason: "SPREADS_IN_PROGRESS", facts_count: 0, spreads_generating: spreadsGenerating },
        }).catch(() => {});

        return NextResponse.json({
          ok: false,
          deal_id: dealId,
          reason: "SPREADS_IN_PROGRESS",
          error: "spreads_in_progress",
          message: "Financial spreads are currently generating. Please wait and try again.",
          facts_count: 0,
          spreads_ready: spreadsReady,
          spreads_generating: spreadsGenerating,
          spreads_error: spreadsError,
        }, { status: 409 });
      }

      logLedgerEvent({
        dealId,
        bankId: access.bankId,
        eventKey: "snapshot.run.failed",
        uiState: "error",
        uiMessage: "Snapshot blocked: no financial facts",
        meta: { reason: "NO_FACTS", facts_count: 0, spreads_ready: spreadsReady },
      }).catch(() => {});

      return NextResponse.json({
        ok: false,
        deal_id: dealId,
        reason: "NO_FACTS",
        error: "no_financial_facts",
        message: "No financial data has been extracted yet. Upload and classify financial documents first, then run Recompute Spreads.",
        facts_count: 0,
        spreads_ready: spreadsReady,
        spreads_generating: spreadsGenerating,
        spreads_error: spreadsError,
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

    // Count populated metrics for completeness
    // DealFinancialSnapshotV1 is a flat object — metrics are direct SnapshotMetricValue props.
    const METRIC_KEYS = [
      "total_income_ttm", "noi_ttm", "opex_ttm", "cash_flow_available",
      "annual_debt_service", "excess_cash_flow", "dscr", "dscr_stressed_300bps",
      "collateral_gross_value", "collateral_net_value", "collateral_discounted_value",
      "collateral_coverage", "ltv_gross", "ltv_net",
      "in_place_rent_mo", "occupancy_pct", "vacancy_pct", "walt_years",
      "total_project_cost", "borrower_equity", "borrower_equity_pct", "bank_loan_total",
      "total_assets", "total_liabilities", "net_worth",
      "gross_receipts", "depreciation_addback", "global_cash_flow",
      "personal_total_income", "pfs_total_assets", "pfs_total_liabilities",
      "pfs_net_worth", "gcf_global_cash_flow", "gcf_dscr",
    ] as const;
    const populatedMetrics = METRIC_KEYS.filter(
      (k) => (snapshot as any)[k]?.value != null,
    );
    const completeness = Math.round((populatedMetrics.length / METRIC_KEYS.length) * 100);
    const missingKeys = METRIC_KEYS.filter(
      (k) => (snapshot as any)[k]?.value == null,
    );

    // Telemetry: snapshot succeeded
    await logLedgerEvent({
      dealId,
      bankId: access.bankId,
      eventKey: "snapshot.run.succeeded",
      uiState: "done",
      uiMessage: `Financial snapshot created (${completeness}% complete)`,
      meta: {
        snapshotId: snapRow.id,
        decisionId: decisionRow.id,
        facts_count: factsVis.total,
        completeness,
        missing_keys: missingKeys,
      },
    });

    return NextResponse.json({
      ok: true,
      deal_id: dealId,
      snapshot_id: snapRow.id,
      decision_id: decisionRow.id,
      facts_count: factsVis.total,
      completeness,
      missing_keys: missingKeys,
      snapshot,
      stress,
      sba,
      narrative,
    });
  } catch (e: any) {
    console.error("[/api/deals/[dealId]/financial-snapshot/recompute]", e);

    // Best-effort telemetry on unexpected error
    try {
      const { dealId: dId } = await (ctx.params);
      const acc = await ensureDealBankAccess(dId).catch(() => null);
      if (acc && (acc as any).bankId) {
        logLedgerEvent({
          dealId: dId,
          bankId: (acc as any).bankId,
          eventKey: "snapshot.run.failed",
          uiState: "error",
          uiMessage: `Snapshot error: ${e?.message ?? "unexpected"}`,
          meta: { reason: "ERROR", error: e?.message },
        }).catch(() => {});
      }
    } catch { /* ignore telemetry errors */ }

    return NextResponse.json({ ok: false, error: e?.message ?? "unexpected_error" }, { status: 500 });
  }
}
