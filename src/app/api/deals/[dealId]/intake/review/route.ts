import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { isIntakeConfirmationGateEnabled } from "@/lib/flags/intakeConfirmationGate";
import { detectStuckProcessing } from "@/lib/intake/processing/detectStuckProcessing";
import { PROCESSING_OBSERVABILITY_VERSION } from "@/lib/intake/constants";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

    // ── Auto-recovery on poll ──────────────────────────────────────────
    // If the deal is stuck in CONFIRMED_READY_FOR_PROCESSING, transition
    // to error state deterministically. Fires at most once per stuck run
    // (phase changes → detection stops on subsequent polls).
    let autoRecovered = false;
    let dealPhase = (deal as any).intake_phase as string | null;

    if (dealPhase === "CONFIRMED_READY_FOR_PROCESSING") {
      const verdict = detectStuckProcessing(
        {
          intake_phase: dealPhase,
          intake_processing_queued_at: (deal as any).intake_processing_queued_at ?? null,
          intake_processing_started_at: (deal as any).intake_processing_started_at ?? null,
          intake_processing_last_heartbeat_at: (deal as any).intake_processing_last_heartbeat_at ?? null,
          intake_processing_run_id: (deal as any).intake_processing_run_id ?? null,
        },
        Date.now(),
      );

      if (verdict.stuck) {
        const errorMsg = `auto_recovery: ${verdict.reason}`;

        void writeEvent({
          dealId,
          kind: "intake.processing_auto_recovery",
          scope: "intake",
          meta: {
            reason: verdict.reason,
            age_ms: verdict.age_ms,
            run_id: (deal as any).intake_processing_run_id ?? null,
            observability_version: PROCESSING_OBSERVABILITY_VERSION,
          },
        });

        await (sb as any)
          .from("deals")
          .update({
            intake_phase: "PROCESSING_COMPLETE_WITH_ERRORS",
            intake_processing_error: errorMsg,
          })
          .eq("id", dealId);

        // Update local copy for response
        dealPhase = "PROCESSING_COMPLETE_WITH_ERRORS";
        autoRecovered = true;
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
         intake_locked_at, created_at`,
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

    return NextResponse.json({
      ok: true,
      intake_phase: dealPhase,
      feature_enabled: isIntakeConfirmationGateEnabled(),
      documents: docs ?? [],
      processing: {
        run_id: (deal as any).intake_processing_run_id ?? null,
        queued_at: (deal as any).intake_processing_queued_at ?? null,
        started_at: (deal as any).intake_processing_started_at ?? null,
        last_heartbeat_at: (deal as any).intake_processing_last_heartbeat_at ?? null,
        error: autoRecovered
          ? `auto_recovery: ${(deal as any).intake_processing_run_id ? "stuck" : "legacy"}`
          : ((deal as any).intake_processing_error ?? null),
        auto_recovered: autoRecovered,
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
