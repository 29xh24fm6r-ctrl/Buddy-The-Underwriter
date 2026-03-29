import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { ensureUnderwritingActivatedCore } from "@/lib/deals/underwriting/ensureUnderwritingActivatedCore";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { emitBuilderLifecycleSignal } from "@/lib/buddy/builderSignals";
import { advanceDealLifecycle } from "@/lib/deals/advanceDealLifecycle";
import { getCanonicalLoanRequestForUnderwriting } from "@/lib/underwritingLaunch/getCanonicalLoanRequest";

export const runtime = "nodejs";

type Params = Promise<{ dealId: string }>;

const CERTIFICATION_TEXT =
  "I confirm this deal's intake package is ready to begin underwriting based on the current confirmed documents, loan request, and requirement state.";

/**
 * POST /api/deals/[dealId]/launch-underwriting
 *
 * Phase 56R: Wraps existing ensureUnderwritingActivatedCore for lifecycle transition.
 * Creates immutable snapshot, workspace, certification ONLY after activation succeeds.
 * Uses deal_loan_requests as canonical loan request source.
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

    // ── Preflight: canonical loan request must be submitted ────────────────
    const { request: canonicalRequest, isSubmitted, requestId } =
      await getCanonicalLoanRequestForUnderwriting(dealId);

    if (!isSubmitted || !canonicalRequest) {
      return NextResponse.json({
        ok: false,
        error: "Cannot launch: no submitted canonical loan request found in deal_loan_requests",
      }, { status: 400 });
    }

    // ── Step 1: Delegate lifecycle transition to existing activation core ──
    const activationResult = await ensureUnderwritingActivatedCore({
      dealId,
      bankId: access.bankId,
      trigger: "launch_underwriting_api",
      deps: { sb, logLedgerEvent, emitBuilderLifecycleSignal, advanceDealLifecycle },
    });

    if (!activationResult.ok && activationResult.status === "failed") {
      return NextResponse.json({
        ok: false,
        error: `Activation failed: ${(activationResult as any).error ?? "unknown"}`,
      }, { status: 400 });
    }

    if (activationResult.status === "blocked") {
      return NextResponse.json({
        ok: false,
        error: "Underwriting blocked by missing required items",
        missing: (activationResult as any).missing ?? [],
      }, { status: 400 });
    }

    // Activation succeeded (activated or already_activated)

    // ── Step 2: Load canonical context for snapshot ────────────────────────
    const { data: deal } = await sb.from("deals").select("*").eq("id", dealId).single();
    const { data: borrower } = await sb.from("borrowers").select("id, legal_name, entity_type")
      .eq("id", deal?.borrower_id).maybeSingle();
    const { data: bank } = await sb.from("banks").select("id, name").eq("id", deal?.bank_id).maybeSingle();
    const { data: docSnapshot } = await sb.from("deal_document_snapshots").select("*").eq("deal_id", dealId).maybeSingle();
    const { data: financialSnapshot } = await sb.from("financial_snapshots").select("id").eq("deal_id", dealId).limit(1).maybeSingle();

    // ── Step 3: Determine launch sequence ─────────────────────────────────
    const { data: priorSnapshots } = await sb.from("underwriting_launch_snapshots")
      .select("launch_sequence").eq("deal_id", dealId).order("launch_sequence", { ascending: false }).limit(1);
    const launchSequence = ((priorSnapshots?.[0] as Record<string, unknown>)?.launch_sequence as number ?? 0) + 1;

    // ── Step 4: Create immutable snapshot with canonical references ────────
    const { data: snapshot, error: snapError } = await sb.from("underwriting_launch_snapshots").insert({
      deal_id: dealId,
      launch_sequence: launchSequence,
      launched_by: userId,
      launched_at: now,
      lifecycle_stage_at_launch: deal?.lifecycle_stage ?? deal?.stage ?? "underwriting",
      borrower_snapshot_json: borrower ?? {},
      deal_snapshot_json: { id: deal?.id, name: deal?.name, bank_id: deal?.bank_id },
      loan_request_snapshot_json: canonicalRequest,
      requirement_snapshot_json: docSnapshot?.requirement_state ?? [],
      document_snapshot_json: docSnapshot ?? {},
      readiness_snapshot_json: docSnapshot?.readiness ?? {},
      blocker_snapshot_json: docSnapshot?.blockers ?? [],
      analyst_handoff_note: body.analyst_handoff_note ?? null,
      certification_json: {
        certifiedBy: userId,
        certifiedAt: now,
        certificationText: CERTIFICATION_TEXT,
        activationStatus: activationResult.status,
      },
      // Canonical references (Phase 56R)
      canonical_loan_request_id: requestId,
      financial_snapshot_id: financialSnapshot?.id ?? null,
      documents_readiness_pct: (docSnapshot?.readiness as any)?.pct ?? null,
      pricing_inputs_present: false,
    }).select("id").single();

    if (snapError || !snapshot) {
      return NextResponse.json({ ok: false, error: `Snapshot creation failed: ${snapError?.message ?? "unknown"}` }, { status: 500 });
    }

    // ── Step 5: Create/update workspace ───────────────────────────────────
    const { data: workspace } = await sb.from("underwriting_workspaces").upsert({
      deal_id: dealId,
      active_snapshot_id: snapshot.id,
      status: "in_progress",
      launched_at: now,
      launched_by: userId,
    }, { onConflict: "deal_id" }).select("id").single();

    // ── Step 6: Write certification ───────────────────────────────────────
    await sb.from("underwriting_launch_certifications").insert({
      deal_id: dealId,
      snapshot_id: snapshot.id,
      certified_by: userId,
      certified_at: now,
      certification_text: CERTIFICATION_TEXT,
      eligibility_json: { activationStatus: activationResult.status, launchSequence },
      handoff_note: body.analyst_handoff_note ?? null,
    });

    // ── Step 7: Audit log ─────────────────────────────────────────────────
    await sb.from("deal_audit_log").insert({
      deal_id: dealId,
      bank_id: access.bankId,
      actor_id: userId,
      event: "underwriting_launched",
      payload: {
        snapshot_id: snapshot.id,
        launch_sequence: launchSequence,
        workspace_id: workspace?.id,
        canonical_loan_request_id: requestId,
        activation_status: activationResult.status,
      },
    }).then(null, () => {});

    return NextResponse.json({
      ok: true,
      launchId: snapshot.id,
      snapshotId: snapshot.id,
      workspaceId: workspace?.id,
      launchSequence,
      activationStatus: activationResult.status,
      status: "launched",
    }, { status: 201 });
  } catch (e: unknown) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Unknown" }, { status: 500 });
  }
}
