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
import { getVisibleFacts, type FactsVisibility } from "@/lib/financialFacts/getVisibleFacts";
import { backfillCanonicalFactsFromSpreads } from "@/lib/financialFacts/backfillFromSpreads";

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

  // Supabase returns numeric columns as strings — parse to number safely
  const toNum = (v: unknown): number | null => {
    if (v == null) return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const principal = toNum((underwrite as any)?.proposed_amount ?? (request as any)?.requested_amount);
  const amortMonths = toNum((underwrite as any)?.proposed_amort_months ?? (request as any)?.requested_amort_months);
  const ioMonths = toNum(
    (underwrite as any)?.proposed_interest_only_months ?? (request as any)?.requested_interest_only_months,
  );
  const rate = toNum((underwrite as any)?.pricing_floor_rate);

  const loanTerms: LoanTerms = {
    principal,
    amortMonths,
    interestOnly: ioMonths != null ? ioMonths > 0 : false,
    rate,
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

    // Collect all blocking reasons before building snapshot
    const preflightReasons: string[] = [];

    // Pre-flight: canonical facts visibility check
    const sb = supabaseAdmin();
    let factsVis: FactsVisibility = await getVisibleFacts(dealId, access.bankId);

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

      // Auto-materialize: if spreads exist but facts were never backfilled, try now
      if (spreadsReady > 0) {
        logLedgerEvent({
          dealId,
          bankId: access.bankId,
          eventKey: "facts.materialization.auto_triggered",
          uiState: "working",
          uiMessage: `Auto-materializing facts from ${spreadsReady} ready spread(s)`,
          meta: { spreads_ready: spreadsReady },
        }).catch(() => {});

        const backfill = await backfillCanonicalFactsFromSpreads({ dealId, bankId: access.bankId });

        logLedgerEvent({
          dealId,
          bankId: access.bankId,
          eventKey: backfill.ok ? "facts.materialization.completed" : "facts.materialization.failed",
          uiState: backfill.ok ? "done" : "error",
          uiMessage: backfill.ok
            ? `${backfill.factsWritten} canonical facts materialized (auto)`
            : `Auto-materialization failed: ${(backfill as any).error}`,
          meta: backfill.ok
            ? { factsWritten: backfill.factsWritten, notes: backfill.notes, trigger: "snapshot_recompute" }
            : { error: (backfill as any).error, trigger: "snapshot_recompute" },
        }).catch(() => {});

        // Re-check facts after materialization
        factsVis = await getVisibleFacts(dealId, access.bankId);
      }

      // Belt + suspenders: try materializing anchor facts from classified documents
      if (factsVis.total === 0) {
        try {
          const { materializeFactsFromArtifacts } = await import(
            "@/lib/financialFacts/materializeFactsFromArtifacts"
          );
          const matResult = await materializeFactsFromArtifacts({
            dealId,
            bankId: access.bankId,
          });

          if (matResult.ok && matResult.factsWritten > 0) {
            logLedgerEvent({
              dealId,
              bankId: access.bankId,
              eventKey: "facts.materialization.from_docs.completed",
              uiState: "done",
              uiMessage: `${matResult.factsWritten} anchor fact(s) materialized from classified documents`,
              meta: {
                factsWritten: matResult.factsWritten,
                docsConsidered: matResult.docsConsidered,
                trigger: "snapshot_recompute_fallback",
              },
            }).catch(() => {});

            factsVis = await getVisibleFacts(dealId, access.bankId);
          } else if (!matResult.ok) {
            logLedgerEvent({
              dealId,
              bankId: access.bankId,
              eventKey: "facts.materialization.from_docs.failed",
              uiState: "error",
              uiMessage: `Artifact-based fact materialization failed: ${(matResult as any).error}`,
              meta: {
                error: (matResult as any).error,
                trigger: "snapshot_recompute_fallback",
              },
            }).catch(() => {});
          }
        } catch (matErr: any) {
          console.warn("[recompute] materializeFactsFromArtifacts fallback threw", matErr?.message);
        }
      }

      // Final fallback: run AI extraction on classified artifacts that haven't been extracted
      if (factsVis.total === 0) {
        try {
          const { extractFactsFromClassifiedArtifacts } = await import(
            "@/lib/financialFacts/extractFactsFromClassifiedArtifacts"
          );
          const extResult = await extractFactsFromClassifiedArtifacts({
            dealId,
            bankId: access.bankId,
          });

          if (extResult.ok && (extResult.extracted > 0 || extResult.backfillFactsWritten > 0)) {
            logLedgerEvent({
              dealId,
              bankId: access.bankId,
              eventKey: "facts.extraction.from_artifacts.completed",
              uiState: "done",
              uiMessage: `Extracted facts from ${extResult.extracted} doc(s), ${extResult.backfillFactsWritten} canonical facts backfilled`,
              meta: {
                extracted: extResult.extracted,
                skipped: extResult.skipped,
                failed: extResult.failed,
                backfillFactsWritten: extResult.backfillFactsWritten,
                trigger: "snapshot_recompute_final_fallback",
              },
            }).catch(() => {});

            factsVis = await getVisibleFacts(dealId, access.bankId);
          } else if (!extResult.ok) {
            logLedgerEvent({
              dealId,
              bankId: access.bankId,
              eventKey: "facts.extraction.from_artifacts.failed",
              uiState: "error",
              uiMessage: `AI extraction fallback failed: ${extResult.error}`,
              meta: { error: extResult.error, trigger: "snapshot_recompute_final_fallback" },
            }).catch(() => {});
          }
        } catch (extErr: any) {
          console.warn("[recompute] extractFactsFromClassifiedArtifacts fallback threw", extErr?.message);
        }
      }

      // If still no facts after all materialization attempts, collect reason
      if (factsVis.total === 0) {
        preflightReasons.push("NO_FACTS");
      }
    }

    // Pre-flight: loan request completeness check (lightweight — mirrors lifecycle engine)
    const { data: loanReqs } = await sb
      .from("deal_loan_requests")
      .select("id, status, requested_amount")
      .eq("deal_id", dealId);
    const loanRows = (loanReqs ?? []) as Array<{ id: string; status: string; requested_amount: number | null }>;
    if (loanRows.length === 0) {
      preflightReasons.push("LOAN_REQUEST_INCOMPLETE");
    } else if (loanRows.some((r) => r.status === "draft" || !r.requested_amount)) {
      preflightReasons.push("LOAN_REQUEST_INCOMPLETE");
    }

    // If any pre-flight reasons, return normalized 422
    if (preflightReasons.length > 0) {
      const messages: Record<string, string> = {
        NO_FACTS: "No financial data extracted yet. Upload and classify documents first.",
        LOAN_REQUEST_INCOMPLETE: "Loan request is missing or has no amount. Complete the loan request first.",
      };
      const message = preflightReasons.map((r) => messages[r] ?? r).join(" ");

      logLedgerEvent({
        dealId,
        bankId: access.bankId,
        eventKey: "snapshot.run.failed",
        uiState: "error",
        uiMessage: `Snapshot blocked: ${preflightReasons.join(", ")}`,
        meta: { reasons: preflightReasons, facts_count: factsVis.total },
      }).catch(() => {});

      return NextResponse.json({
        ok: false,
        deal_id: dealId,
        error: "SNAPSHOT_BLOCKED",
        reasons: preflightReasons,
        reason: preflightReasons[0],
        message,
        facts_count: factsVis.total,
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
