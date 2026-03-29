import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { computeUnderwritingEligibility } from "@/lib/underwritingLaunch/computeEligibility";
import { computeLoanRequestStatus } from "@/lib/dealControl/loanRequestCompleteness";

export const runtime = "nodejs";

type Params = Promise<{ dealId: string }>;

const CERTIFICATION_TEXT =
  "I confirm this deal's intake package is ready to begin underwriting based on the current confirmed documents, loan request, and requirement state.";

/**
 * POST /api/deals/[dealId]/launch-underwriting
 *
 * Creates immutable snapshot, workspace, certification.
 * Rejects if eligibility fails at launch moment.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Params },
) {
  try {
    const { dealId } = await ctx.params;
    const { userId } = await clerkAuth();
    if (!userId) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    if (!body.certification_checked) {
      return NextResponse.json({ ok: false, error: "Certification checkbox is required" }, { status: 400 });
    }

    const sb = supabaseAdmin();
    const now = new Date().toISOString();

    // Load deal + borrower + bank
    const { data: deal } = await sb.from("deals").select("*").eq("id", dealId).single();
    if (!deal) return NextResponse.json({ ok: false, error: "deal_not_found" }, { status: 404 });

    const { data: borrower } = await sb.from("borrowers").select("id, legal_name, entity_type")
      .eq("id", deal.borrower_id).maybeSingle();
    const { data: bank } = await sb.from("banks").select("id, name").eq("id", deal.bank_id).maybeSingle();

    // Load loan request
    const { data: loanRequestRow } = await sb.from("loan_requests").select("*").eq("deal_id", dealId).maybeSingle();
    const lrStatus = computeLoanRequestStatus(loanRequestRow ? {
      id: loanRequestRow.id, dealId, requestName: loanRequestRow.request_name,
      loanAmount: loanRequestRow.loan_amount ? Number(loanRequestRow.loan_amount) : null,
      loanPurpose: loanRequestRow.loan_purpose, loanType: loanRequestRow.loan_type,
      collateralType: loanRequestRow.collateral_type, collateralDescription: loanRequestRow.collateral_description,
      termMonths: loanRequestRow.term_months, amortizationMonths: loanRequestRow.amortization_months,
      interestType: loanRequestRow.interest_type, rateIndex: loanRequestRow.rate_index,
      repaymentType: loanRequestRow.repayment_type, facilityPurpose: loanRequestRow.facility_purpose,
      occupancyType: loanRequestRow.occupancy_type, recourseType: loanRequestRow.recourse_type,
      guarantorRequired: loanRequestRow.guarantor_required ?? false, guarantorNotes: loanRequestRow.guarantor_notes,
      requestedCloseDate: loanRequestRow.requested_close_date, useOfProceedsJson: loanRequestRow.use_of_proceeds_json,
      covenantNotes: loanRequestRow.covenant_notes, structureNotes: loanRequestRow.structure_notes,
      source: loanRequestRow.source ?? "banker", createdBy: loanRequestRow.created_by, updatedBy: loanRequestRow.updated_by,
    } : null);

    // Load document snapshot
    const { data: docSnapshot } = await sb.from("deal_document_snapshots").select("*").eq("deal_id", dealId).maybeSingle();
    const reqState = (docSnapshot?.requirement_state ?? []) as Array<Record<string, unknown>>;
    const blockers = (docSnapshot?.blockers ?? []) as Array<{ code: string }>;

    const satisfiedCount = reqState.filter((r) => r.checklistStatus === "satisfied" || r.checklistStatus === "waived").length;
    const requiredCount = reqState.filter((r) => r.required).length;

    // Eligibility check
    const eligibility = computeUnderwritingEligibility({
      blockers,
      loanRequestStatus: lrStatus.status,
      hasDealName: !!deal.name,
      hasBorrowerId: !!deal.borrower_id,
      hasBankId: !!deal.bank_id,
      applicableRequiredSatisfiedCount: satisfiedCount,
      applicableRequiredTotalCount: requiredCount,
      hasExistingWorkspace: false,
      hasDrift: false,
    });

    if (!eligibility.canLaunch) {
      return NextResponse.json({
        ok: false,
        error: "Deal is not eligible for underwriting launch",
        reasons: eligibility.reasonsNotReady,
      }, { status: 400 });
    }

    // Determine launch sequence
    const { data: priorSnapshots } = await sb.from("underwriting_launch_snapshots")
      .select("launch_sequence").eq("deal_id", dealId).order("launch_sequence", { ascending: false }).limit(1);
    const launchSequence = ((priorSnapshots?.[0] as Record<string, unknown>)?.launch_sequence as number ?? 0) + 1;

    // Create immutable snapshot
    const { data: snapshot, error: snapError } = await sb.from("underwriting_launch_snapshots").insert({
      deal_id: dealId,
      launch_sequence: launchSequence,
      launched_by: userId,
      launched_at: now,
      lifecycle_stage_at_launch: deal.lifecycle_stage ?? "intake",
      borrower_snapshot_json: borrower ?? {},
      deal_snapshot_json: { id: deal.id, name: deal.name, bank_id: deal.bank_id },
      loan_request_snapshot_json: loanRequestRow ?? {},
      requirement_snapshot_json: reqState,
      document_snapshot_json: docSnapshot ?? {},
      readiness_snapshot_json: docSnapshot?.readiness ?? {},
      blocker_snapshot_json: blockers,
      guidance_snapshot_json: null,
      analyst_handoff_note: body.analyst_handoff_note ?? null,
      certification_json: {
        certifiedBy: userId,
        certifiedAt: now,
        certificationText: CERTIFICATION_TEXT,
        eligibility,
      },
    }).select("id").single();

    if (snapError || !snapshot) {
      return NextResponse.json({ ok: false, error: `Snapshot creation failed: ${snapError?.message ?? "unknown"}` }, { status: 500 });
    }

    // Create workspace
    const { data: workspace } = await sb.from("underwriting_workspaces").upsert({
      deal_id: dealId,
      active_snapshot_id: snapshot.id,
      status: "in_progress",
      launched_at: now,
      launched_by: userId,
    }, { onConflict: "deal_id" }).select("id").single();

    // Create certification record
    await sb.from("underwriting_launch_certifications").insert({
      deal_id: dealId,
      snapshot_id: snapshot.id,
      certified_by: userId,
      certified_at: now,
      certification_text: CERTIFICATION_TEXT,
      eligibility_json: eligibility,
      handoff_note: body.analyst_handoff_note ?? null,
    });

    // Update deal lifecycle
    await sb.from("deals").update({ lifecycle_stage: "underwriting" }).eq("id", dealId);

    // Audit
    await sb.from("deal_audit_log").insert({
      deal_id: dealId,
      bank_id: access.bankId,
      actor_id: userId,
      event: "underwriting_launched",
      payload: { snapshot_id: snapshot.id, launch_sequence: launchSequence, workspace_id: workspace?.id },
    }).then(null, () => {});

    return NextResponse.json({
      ok: true,
      launchId: snapshot.id,
      snapshotId: snapshot.id,
      workspaceId: workspace?.id,
      launchSequence,
      status: "launched",
    }, { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}
