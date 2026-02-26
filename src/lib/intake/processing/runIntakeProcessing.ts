/**
 * Pure execution function for intake processing.
 *
 * Extracted from /api/deals/[dealId]/intake/process/route.ts so that both
 * the HTTP route (banker manual trigger) and the outbox consumer can call
 * the same processing pipeline.
 *
 * Sequence:
 *   1. Precondition: all active deal_documents must have finalized_at IS NOT NULL
 *   2. Backfill missing document_artifacts
 *   3. Emit intake.processing_started event
 *   4. Durable processing (enqueueDealProcessing → processConfirmedIntake)
 *   5. Emit intake.processing_route_complete event
 *
 * Outer catch GUARANTEES terminal phase transition on failure:
 *   → PROCESSING_COMPLETE_WITH_ERRORS (via CAS on run_id)
 *
 * No HTTP, no Lambda lifecycle dependency. Safe for any caller context.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { enqueueDealProcessing } from "@/lib/intake/processing/enqueueDealProcessing";
import { updateDealIfRunOwner } from "@/lib/intake/processing/updateDealIfRunOwner";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { backfillDealArtifacts } from "@/lib/artifacts/queueArtifact";
import {
  PROCESSING_OBSERVABILITY_VERSION,
  SOFT_DEADLINE_MS,
} from "@/lib/intake/constants";

export async function runIntakeProcessing(
  dealId: string,
  bankId: string,
  runId: string,
): Promise<void> {
  const startMs = Date.now();

  try {
    // ── Precondition: all active docs must be confirmed (finalized_at) ──
    const sb = supabaseAdmin();
    const { count: unfinalized } = await sb
      .from("deal_documents")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .eq("is_active", true)
      .is("finalized_at", null);

    if ((unfinalized ?? 0) > 0) {
      throw new Error(`documents_not_confirmed: ${unfinalized} unfinalized docs`);
    }

    // ── Backfill missing artifacts ───────────────────────────────────────
    const backfill = await backfillDealArtifacts(dealId, bankId);

    await writeEvent({
      dealId,
      kind: "intake.artifacts_backfilled",
      scope: "intake",
      meta: {
        queued: backfill.queued,
        skipped: backfill.skipped,
        errors: backfill.errors,
        triggered_by: "outbox_consumer",
        observability_version: PROCESSING_OBSERVABILITY_VERSION,
      },
    });

    // ── Emit canonical processing_started event ─────────────────────────
    await writeEvent({
      dealId,
      kind: "intake.processing_started",
      scope: "intake",
      meta: {
        run_id: runId,
        bank_id: bankId,
        triggered_by: "outbox_consumer",
        artifacts_backfilled: backfill.queued,
        observability_version: PROCESSING_OBSERVABILITY_VERSION,
      },
    });

    // ── Durable processing with soft deadline guard ─────────────────────
    const result = await Promise.race([
      enqueueDealProcessing(dealId, bankId, runId),
      (async () => {
        await new Promise((r) => setTimeout(r, SOFT_DEADLINE_MS));

        await writeEvent({
          dealId,
          kind: "intake.processing_soft_deadline_hit",
          scope: "intake",
          meta: {
            run_id: runId,
            elapsed_ms: Date.now() - startMs,
            soft_deadline_ms: SOFT_DEADLINE_MS,
            observability_version: PROCESSING_OBSERVABILITY_VERSION,
          },
        });

        await updateDealIfRunOwner(dealId, runId, {
          intake_phase: "PROCESSING_COMPLETE_WITH_ERRORS",
          intake_processing_error: `soft_deadline: processing exceeded ${SOFT_DEADLINE_MS}ms`,
        });

        throw new Error("SOFT_DEADLINE_EXCEEDED");
      })(),
    ]);

    // ── Gate check: enqueueDealProcessing may return {ok: false} ────────
    if (!result.ok) {
      throw new Error(`processing_gated: ${result.reason}`);
    }

    // ── Emit completion event ───────────────────────────────────────────
    await writeEvent({
      dealId,
      kind: "intake.processing_route_complete",
      scope: "intake",
      meta: {
        run_id: runId,
        elapsed_ms: Date.now() - startMs,
        ok: true,
        triggered_by: "outbox_consumer",
        observability_version: PROCESSING_OBSERVABILITY_VERSION,
      },
    });
  } catch (err: any) {
    const elapsed = Date.now() - startMs;
    const isSoftDeadline = err?.message === "SOFT_DEADLINE_EXCEEDED";

    console.error("[runIntakeProcessing] failed", {
      dealId,
      runId,
      error: err?.message,
      elapsed,
      soft_deadline: isSoftDeadline,
    });

    // Guarantee terminal phase transition (soft deadline already transitioned above)
    if (!isSoftDeadline) {
      try {
        await updateDealIfRunOwner(dealId, runId, {
          intake_phase: "PROCESSING_COMPLETE_WITH_ERRORS",
          intake_processing_error: `process_failed: ${err?.message?.slice(0, 200)}`,
        });
      } catch (transitionErr: any) {
        console.error("[runIntakeProcessing] failed to transition phase", {
          dealId,
          runId,
          error: transitionErr?.message,
        });
      }

      await writeEvent({
        dealId,
        kind: "intake.processing_route_error",
        scope: "intake",
        meta: {
          run_id: runId,
          elapsed_ms: elapsed,
          error: err?.message?.slice(0, 200),
          triggered_by: "outbox_consumer",
          observability_version: PROCESSING_OBSERVABILITY_VERSION,
        },
      });
    }

    // Re-throw so the consumer can mark the outbox row as failed
    throw err;
  }
}
