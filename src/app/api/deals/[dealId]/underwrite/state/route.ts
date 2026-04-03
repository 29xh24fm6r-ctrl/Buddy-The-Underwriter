import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { buildSpreadSeedPackage, buildMemoSeedPackage } from "@/lib/underwritingLaunch/buildSeedPackages";
import { detectCanonicalDrift } from "@/lib/underwritingLaunch/detectCanonicalDrift";
import { getCanonicalLoanRequestForUnderwriting } from "@/lib/underwritingLaunch/getCanonicalLoanRequest";
import { buildTrustLayer } from "@/lib/underwrite/buildTrustLayer";

export const runtime = "nodejs";
export const maxDuration = 30;

type Params = Promise<{ dealId: string }>;

/**
 * GET /api/deals/[dealId]/underwrite/state
 * Returns full analyst workbench state: workspace, snapshot, drift, seed packages.
 */
export async function GET(
  _req: NextRequest,
  ctx: { params: Params },
) {
  try {
    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) return NextResponse.json({ ok: false, error: access.error }, { status: 403 });

    const sb = supabaseAdmin();

    // Load deal + borrower + bank
    const { data: deal } = await sb.from("deals").select("id, name, borrower_id, bank_id, stage").eq("id", dealId).single();
    if (!deal) return NextResponse.json({ ok: false, error: "deal_not_found" }, { status: 404 });

    const { data: borrower } = await sb.from("borrowers").select("id, legal_name, entity_type").eq("id", deal.borrower_id).maybeSingle();
    const { data: bank } = await sb.from("banks").select("id, name").eq("id", deal.bank_id).maybeSingle();

    // Load workspace
    const { data: workspace } = await sb.from("underwriting_workspaces").select("*").eq("deal_id", dealId).maybeSingle();

    // Load active snapshot
    let activeSnapshot: Record<string, unknown> | null = null;
    if (workspace?.active_snapshot_id) {
      const { data: snap } = await sb.from("underwriting_launch_snapshots").select("*").eq("id", workspace.active_snapshot_id).maybeSingle();
      activeSnapshot = snap;
    }

    // Build seed packages from snapshot
    let spreadSeed = null;
    let memoSeed = null;

    if (activeSnapshot) {
      const reqSnapshot = activeSnapshot.requirement_snapshot_json as Array<Record<string, unknown>> ?? [];
      const loanReqSnapshot = activeSnapshot.loan_request_snapshot_json as Record<string, unknown> ?? {};
      const borrowerSnapshot = activeSnapshot.borrower_snapshot_json as Record<string, unknown> ?? {};
      const dealSnapshot = activeSnapshot.deal_snapshot_json as Record<string, unknown> ?? {};

      const confirmedDocs = reqSnapshot
        .filter((r) => r.checklistStatus === "satisfied" || r.checklistStatus === "received")
        .flatMap((r) => ((r.matchedDocumentIds as string[]) ?? []).map((docId) => ({
          requirementCode: r.code as string,
          documentId: docId,
          fileName: "",
          canonicalDocType: r.code as string,
          periodYear: ((r.matchedYears as number[]) ?? [])[0] ?? undefined,
        })));

      const seedData = {
        snapshotId: activeSnapshot.id as string,
        borrowerLegalName: (borrowerSnapshot.legal_name as string) ?? borrower?.legal_name ?? "",
        borrowerEntityType: (borrowerSnapshot.entity_type as string) ?? null,
        dealName: (dealSnapshot.name as string) ?? deal.name ?? "",
        bankName: bank?.name ?? "",
        launchedAt: (activeSnapshot.launched_at as string) ?? "",
        launchedBy: (activeSnapshot.launched_by as string) ?? "",
        handoffNote: (activeSnapshot.analyst_handoff_note as string) ?? null,
        loanRequest: {
          loanAmount: loanReqSnapshot.requested_amount ? Number(loanReqSnapshot.requested_amount) : null,
          loanType: (loanReqSnapshot.product_type as string) ?? null,
          loanPurpose: (loanReqSnapshot.purpose as string) ?? null,
          facilityPurpose: (loanReqSnapshot.facility_purpose as string) ?? (loanReqSnapshot.purpose as string) ?? null,
          collateralType: (loanReqSnapshot.collateral_type as string) ?? null,
          termMonths: (loanReqSnapshot.requested_term_months as number) ?? null,
          amortizationMonths: (loanReqSnapshot.amortization_months as number) ?? null,
          interestType: (loanReqSnapshot.interest_type as string) ?? null,
          recourseType: (loanReqSnapshot.recourse_type as string) ?? null,
        },
        confirmedDocuments: confirmedDocs,
      };

      spreadSeed = buildSpreadSeedPackage(seedData);
      memoSeed = buildMemoSeedPackage(seedData);
    }

    // Drift detection
    let drift = null;
    if (activeSnapshot) {
      const { request: currentRequest } = await getCanonicalLoanRequestForUnderwriting(dealId);
      const { data: currentFinSnap } = await sb.from("financial_snapshots").select("id").eq("deal_id", dealId).limit(1).maybeSingle();
      const { data: currentDocSnap } = await sb.from("deal_document_snapshots").select("readiness").eq("deal_id", dealId).maybeSingle();

      const currentReadiness = currentDocSnap?.readiness as Record<string, unknown> | null;
      const loanReqSnap = activeSnapshot.loan_request_snapshot_json as Record<string, unknown>;

      drift = detectCanonicalDrift({
        snapshotCanonicalLoanRequestId: (activeSnapshot.canonical_loan_request_id as string) ?? null,
        snapshotFinancialSnapshotId: (activeSnapshot.financial_snapshot_id as string) ?? null,
        snapshotLifecycleStage: (activeSnapshot.lifecycle_stage_at_launch as string) ?? "",
        snapshotDocumentsReadinessPct: (activeSnapshot.documents_readiness_pct as number) ?? null,
        currentCanonicalLoanRequestId: currentRequest?.id ? String(currentRequest.id) : null,
        currentCanonicalLoanRequestUpdatedAt: currentRequest?.updated_at ? String(currentRequest.updated_at) : null,
        currentFinancialSnapshotId: currentFinSnap?.id ?? null,
        currentLifecycleStage: deal.stage ?? "",
        currentDocumentsReadinessPct: currentReadiness?.pct != null ? Number(currentReadiness.pct) : null,
        currentBlockerCount: 0,
        snapshotLoanAmount: loanReqSnap?.requested_amount ? Number(loanReqSnap.requested_amount) : null,
        currentLoanAmount: currentRequest?.requested_amount ? Number(currentRequest.requested_amount) : null,
        snapshotProductType: (loanReqSnap?.product_type as string) ?? null,
        currentProductType: currentRequest?.product_type ? String(currentRequest.product_type) : null,
        snapshotCollateralType: (loanReqSnap?.collateral_type as string) ?? null,
        currentCollateralType: currentRequest?.collateral_type ? String(currentRequest.collateral_type) : null,
      });
    }

    // Trust layer — composed from canonical memo/packet/financial validation sources
    let trustLayer = null;
    try {
      trustLayer = await buildTrustLayer(dealId);
    } catch (err) {
      console.warn("[underwrite/state] trust layer failed — degrading safely:", err);
    }

    return NextResponse.json({
      ok: true,
      deal: {
        id: deal.id,
        dealName: deal.name,
        borrowerLegalName: borrower?.legal_name ?? "",
        bankName: bank?.name ?? "",
        lifecycleStage: deal.stage,
      },
      workspace: workspace ? {
        id: workspace.id,
        status: workspace.status,
        spreadStatus: workspace.spread_status,
        memoStatus: workspace.memo_status,
        riskStatus: workspace.risk_status,
        assignedAnalystId: workspace.assigned_analyst_id,
        refreshRequired: workspace.refresh_required,
        launchedAt: workspace.launched_at,
        launchedBy: workspace.launched_by,
      } : null,
      activeSnapshot: activeSnapshot ? {
        id: activeSnapshot.id,
        launchSequence: activeSnapshot.launch_sequence,
        launchedAt: activeSnapshot.launched_at,
        launchedBy: activeSnapshot.launched_by,
        analystHandoffNote: activeSnapshot.analyst_handoff_note,
        canonicalLoanRequestId: activeSnapshot.canonical_loan_request_id,
        financialSnapshotId: activeSnapshot.financial_snapshot_id,
      } : null,
      drift,
      spreadSeed,
      memoSeed,
      trustLayer,
      riskSummary: { notesCount: 0, openQuestionsCount: 0, exceptionsCount: 0 },
    });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}
