import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { recomputeDealDocumentState } from "@/lib/documentTruth/recomputeDealDocumentState";
import { computeReadinessAndBlockers } from "@/lib/documentTruth/computeReadinessAndBlockers";
import { getRequirementsForDealType } from "@/lib/documentTruth/requirementRegistry";
import {
  computeLoanRequestStatus,
  deriveLoanRequestBlocker,
  deriveNextBestAction,
  buildBankerExplanation,
} from "@/lib/dealControl/loanRequestCompleteness";

export const runtime = "nodejs";

type Params = Promise<{ dealId: string }>;

/**
 * GET /api/deals/[dealId]/cockpit-state
 *
 * Single source of truth for the entire cockpit.
 * Returns deal identity, document state, readiness, blockers, permissions.
 * All panels must derive from this response — no independent queries.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Params },
) {
  try {
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
    }

    const sb = supabaseAdmin();
    const { searchParams } = new URL(req.url);
    const forceRecompute = searchParams.get("recompute") === "1";

    // ── Deal + Borrower identity ──────────────────────────────────────────
    const { data: deal } = await sb
      .from("deals")
      .select("id, name, borrower_name, borrower_id, bank_id, lifecycle_stage, deal_type")
      .eq("id", dealId)
      .single();

    if (!deal) {
      return NextResponse.json({ ok: false, error: "deal_not_found" }, { status: 404 });
    }

    // Resolve borrower
    let borrower: { id: string; legal_name: string } | null = null;
    if (deal.borrower_id) {
      const { data: b } = await sb
        .from("borrowers")
        .select("id, legal_name")
        .eq("id", deal.borrower_id)
        .maybeSingle();
      borrower = b ? { id: b.id, legal_name: b.legal_name ?? "" } : null;
    }

    // Resolve bank
    const { data: bank } = await sb
      .from("banks")
      .select("id, name")
      .eq("id", deal.bank_id)
      .maybeSingle();

    // ── Load document snapshot ────────────────────────────────────────────
    let { data: snapshot } = await sb
      .from("deal_document_snapshots")
      .select("requirement_state, readiness, blockers, computed_at")
      .eq("deal_id", dealId)
      .maybeSingle();

    // ── Recompute if needed ───────────────────────────────────────────────
    // Auto-recompute when: (a) ?recompute=1 forced, OR (b) no snapshot exists.
    // Case (b) is the defensive fallback for deals that completed intake before
    // recomputeDealDocumentState was wired into the processing pipeline.
    if (forceRecompute || !snapshot) {
      await recomputeDealDocumentState(dealId);
      // Reload snapshot after recompute
      const { data: freshSnapshot } = await sb
        .from("deal_document_snapshots")
        .select("requirement_state, readiness, blockers, computed_at")
        .eq("deal_id", dealId)
        .maybeSingle();
      snapshot = freshSnapshot;
    }

    // ── Load supplemental state ───────────────────────────────────────────
    // Phase 56R: deal_loan_requests is the ONLY canonical loan request source
    const { data: canonicalLoanRequest } = await sb
      .from("deal_loan_requests")
      .select("*")
      .eq("deal_id", dealId)
      .order("request_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Phase 56R.1: No fallback to legacy loan_requests. Canonical only.
    const loanRequest = canonicalLoanRequest;
    const loanRequestRow: Record<string, unknown> | null = null;

    const { data: spreads } = await sb
      .from("deal_spreads")
      .select("id")
      .eq("deal_id", dealId)
      .limit(1)
      .maybeSingle();

    const { data: financialSnapshot } = await sb
      .from("financial_snapshots")
      .select("id")
      .eq("deal_id", dealId)
      .limit(1)
      .maybeSingle();

    // ── Compute readiness + blockers ──────────────────────────────────────
    const reqState = (snapshot?.requirement_state ?? []) as Array<{
      code: string;
      label: string;
      group: string;
      required: boolean;
      checklistStatus: string;
      readinessStatus: string;
      matchedDocumentIds: string[];
      reasons: string[];
    }>;

    const dealType = (deal as Record<string, unknown>).deal_type as string ?? "conventional";
    const applicableRequirements = getRequirementsForDealType(dealType);
    const applicableCodes = new Set<string>(applicableRequirements.map((r) => r.code));

    const readinessInput = {
      requirements: reqState.map((r) => ({
        code: r.code,
        label: r.label,
        group: r.group,
        required: r.required,
        applicable: applicableCodes.has(r.code),
        checklistStatus: r.checklistStatus as "missing" | "received" | "satisfied" | "waived",
        reviewPending: r.readinessStatus === "warning",
        matchedDocumentCount: r.matchedDocumentIds?.length ?? 0,
      })),
      hasLoanRequest: !!loanRequest,
      hasSpreads: !!spreads,
      hasFinancialSnapshot: !!financialSnapshot,
      hasPricingQuote: false,
      hasDecision: false,
    };

    const { categories, blockers: docBlockers, readinessPercent } = computeReadinessAndBlockers(readinessInput);

    // ── Loan request status + blockers ────────────────────────────────────
    // Phase 56R.1: derive from canonical deal_loan_requests only
    const clr = canonicalLoanRequest as Record<string, unknown> | null;
    const mappedLoanRequest = clr ? {
      id: clr.id as string,
      dealId: (clr.deal_id as string) ?? dealId,
      requestName: (clr.request_name as string) ?? null,
      loanAmount: clr.requested_amount ? Number(clr.requested_amount) : null,
      loanPurpose: (clr.purpose as string) ?? (clr.loan_purpose as string) ?? null,
      loanType: (clr.product_type as string) ?? (clr.loan_type as string) ?? null,
      collateralType: (clr.collateral_type as string) ?? null,
      collateralDescription: (clr.collateral_description as string) ?? null,
      termMonths: (clr.requested_term_months as number) ?? null,
      amortizationMonths: (clr.amortization_months as number) ?? null,
      interestType: (clr.interest_type as string) ?? null,
      rateIndex: (clr.rate_index as string) ?? null,
      repaymentType: (clr.repayment_type as string) ?? null,
      facilityPurpose: (clr.facility_purpose as string) ?? (clr.purpose as string) ?? null,
      occupancyType: (clr.occupancy_type as string) ?? null,
      recourseType: (clr.recourse_type as string) ?? null,
      guarantorRequired: (clr.guarantor_required as boolean) ?? false,
      guarantorNotes: (clr.guarantor_notes as string) ?? null,
      requestedCloseDate: (clr.requested_close_date as string) ?? null,
      useOfProceedsJson: (clr.use_of_proceeds_json as Record<string, unknown>) ?? null,
      covenantNotes: (clr.covenant_notes as string) ?? null,
      structureNotes: (clr.structure_notes as string) ?? null,
      source: (clr.source as string) ?? "banker",
      createdBy: (clr.created_by as string) ?? "",
      updatedBy: (clr.updated_by as string) ?? "",
    } : null;

    const lrStatus = computeLoanRequestStatus(mappedLoanRequest);
    const lrBlocker = deriveLoanRequestBlocker(mappedLoanRequest);

    // Merge all blockers
    const allBlockers = [...docBlockers];
    if (lrBlocker) {
      allBlockers.unshift({
        code: lrBlocker.code,
        severity: "blocking",
        title: lrBlocker.title,
        details: lrBlocker.details,
        actionLabel: lrBlocker.actionLabel,
      });
    }

    // ── Next best action + guidance ───────────────────────────────────────
    const reviewRequiredCount = reqState.filter(
      (r) => r.readinessStatus === "warning" && applicableCodes.has(r.code),
    ).length;
    const missingRequiredCount = reqState.filter(
      (r) => r.checklistStatus === "missing" && applicableCodes.has(r.code),
    ).length;

    const nextBestAction = deriveNextBestAction({
      loanRequestStatus: lrStatus.status,
      reviewRequiredCount,
      missingRequiredCount,
    });

    const bankerExplanation = buildBankerExplanation(allBlockers);

    return NextResponse.json({
      ok: true,
      deal: {
        id: deal.id,
        dealName: deal.name,
        borrower: borrower
          ? { id: borrower.id, legalName: borrower.legal_name }
          : null,
        bank: bank ? { id: bank.id, name: bank.name } : null,
        lifecycleStage: deal.lifecycle_stage,
      },
      documentState: {
        requirements: reqState,
        computedAt: snapshot?.computed_at ?? null,
      },
      readiness: {
        percent: readinessPercent,
        categories,
      },
      blockers: allBlockers,
      nextBestAction,
      guidance: {
        bankerExplanation,
      },
      loanRequest: {
        status: lrStatus.status,
        missingFields: lrStatus.missingFields,
        summary: mappedLoanRequest ? {
          loanAmount: mappedLoanRequest.loanAmount,
          loanType: mappedLoanRequest.loanType,
          facilityPurpose: mappedLoanRequest.facilityPurpose,
          collateralType: mappedLoanRequest.collateralType,
        } : null,
      },
      permissions: {
        canEditLoanRequest: true,
        canReviewDocuments: true,
        canWaiveRequirements: false,
        canViewAuditTrail: false,
      },
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
