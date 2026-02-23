import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { detectStuckProcessing } from "@/lib/intake/processing/detectStuckProcessing";
import { updateDealIfRunOwner } from "@/lib/intake/processing/updateDealIfRunOwner";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { PROCESSING_OBSERVABILITY_VERSION } from "@/lib/intake/constants";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * GET /api/deals/[dealId]/intake/processing-status
 *
 * Lightweight endpoint — returns only processing run markers (no document list).
 * Performs auto-recovery if stuck (same logic as review route).
 *
 * Intended for fast polling during processing without the overhead of loading
 * all documents from the review endpoint.
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

    let autoRecovered = false;
    let phase = (deal as any).intake_phase as string | null;
    let dealError: string | null = (deal as any).intake_processing_error ?? null;

    // ── Auto-recovery (mirrors review route logic) ───────────────────────
    if (phase === "CONFIRMED_READY_FOR_PROCESSING") {
      const queuedAt = (deal as any).intake_processing_queued_at ?? null;
      const confirmedSinceMs = queuedAt ? new Date(queuedAt as string).getTime() : undefined;

      const verdict = detectStuckProcessing(
        {
          intake_phase: phase,
          intake_processing_queued_at: queuedAt,
          intake_processing_started_at: (deal as any).intake_processing_started_at ?? null,
          intake_processing_last_heartbeat_at: (deal as any).intake_processing_last_heartbeat_at ?? null,
          intake_processing_run_id: (deal as any).intake_processing_run_id ?? null,
        },
        Date.now(),
        confirmedSinceMs,
      );

      if (verdict.stuck) {
        const errorMsg = `auto_recovery: ${verdict.reason}`;
        const runId: string | undefined = (deal as any).intake_processing_run_id ?? undefined;

        void writeEvent({
          dealId,
          kind: "intake.processing_auto_recovery",
          scope: "intake",
          meta: {
            reason: verdict.reason,
            age_ms: verdict.age_ms,
            run_id: runId ?? null,
            observability_version: PROCESSING_OBSERVABILITY_VERSION,
          },
        });

        await updateDealIfRunOwner(dealId, runId, {
          intake_phase: "PROCESSING_COMPLETE_WITH_ERRORS",
          intake_processing_error: errorMsg,
        });

        phase = "PROCESSING_COMPLETE_WITH_ERRORS";
        dealError = errorMsg;
        autoRecovered = true;
      }
    }

    return NextResponse.json({
      ok: true,
      intake_phase: phase,
      processing: {
        run_id: (deal as any).intake_processing_run_id ?? null,
        queued_at: (deal as any).intake_processing_queued_at ?? null,
        started_at: (deal as any).intake_processing_started_at ?? null,
        last_heartbeat_at: (deal as any).intake_processing_last_heartbeat_at ?? null,
        error: dealError,
        auto_recovered: autoRecovered,
      },
    });
  } catch (e: any) {
    rethrowNextErrors(e);
    console.error("[intake/processing-status]", e);
    return NextResponse.json(
      { ok: false, error: "unexpected_error" },
      { status: 500 },
    );
  }
}
