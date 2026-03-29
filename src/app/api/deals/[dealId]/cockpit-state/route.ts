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

    // ── Recompute if needed ───────────────────────────────────────────────
    if (forceRecompute) {
      await recomputeDealDocumentState(dealId);
    }

    // ── Load document snapshot ────────────────────────────────────────────
    const { data: snapshot } = await sb
      .from("deal_document_snapshots")
      .select("requirement_state, readiness, blockers, computed_at")
      .eq("deal_id", dealId)
      .maybeSingle();

    // ── Load supplemental state ───────────────────────────────────────────
    // Phase 56R: deal_loan_requests is the ONLY canonical loan request source
    const { data: canonicalLoanRequest } = await sb
      .from("deal_loan_requests")
      .select("*")
      .eq("deal_id", dealId)
      .order("request_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Fallback check Phase 55 table during migration period only
    const { data: phase55LoanRequest } = !canonicalLoanRequest
      ? await sb.from("loan_requests").select("*").eq("deal_id", dealId).maybeSingle()
      : { data: null };

    const loanRequest = canonicalLoanRequest || phase55LoanRequest;
    const loanRequestRow = phase55LoanRequest;

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
    const mappedLoanRequest = loanRequestRow ? {
      id: loanRequestRow.id,
      dealId: loanRequestRow.deal_id,
      requestName: loanRequestRow.request_name,
      loanAmount: loanRequestRow.loan_amount ? Number(loanRequestRow.loan_amount) : null,
      loanPurpose: loanRequestRow.loan_purpose,
      loanType: loanRequestRow.loan_type,
      collateralType: loanRequestRow.collateral_type,
      collateralDescription: loanRequestRow.collateral_description,
      termMonths: loanRequestRow.term_months,
      amortizationMonths: loanRequestRow.amortization_months,
      interestType: loanRequestRow.interest_type,
      rateIndex: loanRequestRow.rate_index,
      repaymentType: loanRequestRow.repayment_type,
      facilityPurpose: loanRequestRow.facility_purpose,
      occupancyType: loanRequestRow.occupancy_type,
      recourseType: loanRequestRow.recourse_type,
      guarantorRequired: loanRequestRow.guarantor_required ?? false,
      guarantorNotes: loanRequestRow.guarantor_notes,
      requestedCloseDate: loanRequestRow.requested_close_date,
      useOfProceedsJson: loanRequestRow.use_of_proceeds_json,
      covenantNotes: loanRequestRow.covenant_notes,
      structureNotes: loanRequestRow.structure_notes,
      source: loanRequestRow.source ?? "banker",
      createdBy: loanRequestRow.created_by,
      updatedBy: loanRequestRow.updated_by,
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
