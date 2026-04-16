import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { isIntakeConfirmationGateEnabled } from "@/lib/flags/intakeConfirmationGate";
import { detectStuckProcessing } from "@/lib/intake/processing/detectStuckProcessing";
import { handleStuckRecovery } from "@/lib/intake/processing/handleStuckRecovery";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * GET /api/deals/[dealId]/intake/review
 *
 * Returns documents sorted by classification confidence ASC (worst first).
 * Used by the IntakeReviewTable UI component.
 *
 * Also returns processing run markers and performs auto-recovery
 * if the processing run is detected as stuck.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const { dealId } = await ctx.params;

    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      const status =
        access.error === "deal_not_found" ? 404 :
        access.error === "tenant_mismatch" ? 403 : 401;
      return NextResponse.json({ ok: false, error: access.error }, { status });
    }

    const sb = supabaseAdmin();

    // Load deal phase + processing run markers
    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select(
        "intake_phase, intake_processing_queued_at, intake_processing_started_at, " +
        "intake_processing_last_heartbeat_at, intake_processing_run_id, intake_processing_error",
      )
      .eq("id", dealId)
      .maybeSingle();

    if (dealErr || !deal) {
      return NextResponse.json(
        { ok: false, error: "deal_not_found" },
        { status: 404 },
      );
    }

    // ── Auto-recovery on poll (FIX 2A: actionable for queued_never_started) ──
    // If stuck in CONFIRMED_READY_FOR_PROCESSING:
    // - queued_never_started → re-enqueue processing with fresh run_id
    // - other reasons → transition to PROCESSING_COMPLETE_WITH_ERRORS
    let autoRecovered = false;
    let reenqueued = false;
    let dealPhase = (deal as any).intake_phase as string | null;
    let dealError: string | null = (deal as any).intake_processing_error ?? null;

    if (dealPhase === "CONFIRMED_READY_FOR_PROCESSING") {
      const queuedAt = (deal as any).intake_processing_queued_at ?? null;
      const confirmedSinceMs = queuedAt ? new Date(queuedAt as string).getTime() : undefined;

      const verdict = detectStuckProcessing(
        {
          intake_phase: dealPhase,
          intake_processing_queued_at: queuedAt,
          intake_processing_started_at: (deal as any).intake_processing_started_at ?? null,
          intake_processing_last_heartbeat_at: (deal as any).intake_processing_last_heartbeat_at ?? null,
          intake_processing_run_id: (deal as any).intake_processing_run_id ?? null,
        },
        Date.now(),
        confirmedSinceMs,
      );

      if (verdict.stuck) {
        const staleRunId: string | undefined = (deal as any).intake_processing_run_id ?? undefined;
        const outcome = await handleStuckRecovery(
          dealId,
          access.bankId,
          verdict,
          staleRunId,
        );

        dealPhase = outcome.phase;
        dealError = outcome.error;
        autoRecovered = outcome.recovered;
        reenqueued = outcome.reenqueued;
      }
    }

    // Load active documents sorted by confidence ASC (nulls first = worst first)
    const { data: docs, error: docsErr } = await (sb as any)
      .from("deal_documents")
      .select(
        `id, original_filename, canonical_type, document_type,
         checklist_key, doc_year, match_source,
         ai_doc_type, ai_confidence, ai_tax_year,
         classification_tier,
         gatekeeper_doc_type, gatekeeper_confidence,
         gatekeeper_needs_review, gatekeeper_route,
         intake_status, intake_confirmed_at, intake_confirmed_by,
         intake_locked_at, created_at, statement_period,
         assigned_owner_id, subject_ids,
         joint_filer_confirmed, joint_filer_detection_source`,
      )
      .eq("deal_id", dealId)
      .eq("is_active", true)
      .order("ai_confidence", { ascending: true, nullsFirst: true });

    if (docsErr) {
      return NextResponse.json(
        { ok: false, error: "query_failed", detail: docsErr.message },
        { status: 500 },
      );
    }

    // Phase 82: Enrich documents with joint filer facts from deal_financial_facts
    const docIds = (docs ?? []).map((d: any) => d.id);
    let jointFactsByDoc: Map<string, Record<string, string>> = new Map();
    if (docIds.length > 0) {
      try {
        const { data: jointFacts } = await (sb as any)
          .from("deal_financial_facts")
          .select("source_document_id, fact_key, fact_value_text")
          .eq("deal_id", dealId)
          .in("fact_key", ["PTR_FILING_STATUS", "PTR_SPOUSE_NAME", "PFS_IS_JOINT", "PFS_CO_APPLICANT_NAME"])
          .in("source_document_id", docIds);

        for (const f of jointFacts ?? []) {
          const docId = f.source_document_id as string;
          if (!jointFactsByDoc.has(docId)) jointFactsByDoc.set(docId, {});
          jointFactsByDoc.get(docId)![f.fact_key as string] = f.fact_value_text as string;
        }
      } catch {
        // Non-critical — banner just won't show if facts query fails
      }
    }

    const enrichedDocs = (docs ?? []).map((d: any) => {
      const facts = jointFactsByDoc.get(d.id) ?? {};
      return {
        ...d,
        // Alias assigned_owner_id → subject_id for client compatibility
        subject_id: d.assigned_owner_id ?? null,
        ptr_filing_status: facts["PTR_FILING_STATUS"] ?? null,
        ptr_spouse_name: facts["PTR_SPOUSE_NAME"] ?? null,
        pfs_is_joint: facts["PFS_IS_JOINT"] === "true" ? true : facts["PFS_IS_JOINT"] === "false" ? false : null,
        pfs_co_applicant_name: facts["PFS_CO_APPLICANT_NAME"] ?? null,
      };
    });

    return NextResponse.json({
      ok: true,
      intake_phase: dealPhase,
      feature_enabled: isIntakeConfirmationGateEnabled(),
      documents: enrichedDocs,
      processing: {
        run_id: (deal as any).intake_processing_run_id ?? null,
        queued_at: (deal as any).intake_processing_queued_at ?? null,
        started_at: (deal as any).intake_processing_started_at ?? null,
        last_heartbeat_at: (deal as any).intake_processing_last_heartbeat_at ?? null,
        error: dealError,
        auto_recovered: autoRecovered,
        reenqueued,
      },
    });
  } catch (e: any) {
    rethrowNextErrors(e);
    console.error("[intake/review]", e);
    return NextResponse.json(
      { ok: false, error: "unexpected_error" },
      { status: 500 },
    );
  }
}
