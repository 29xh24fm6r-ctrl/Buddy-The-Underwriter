import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { detectStuckProcessing } from "@/lib/intake/processing/detectStuckProcessing";
import { handleStuckRecovery } from "@/lib/intake/processing/handleStuckRecovery";
import { isOutboxStalled } from "@/lib/intake/processing/detectOutboxStall";
import { emitOutboxStalledEventIfNeeded } from "@/lib/intake/processing/emitOutboxStalledEvent";
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
    let reenqueued = false;
    let phase = (deal as any).intake_phase as string | null;
    let dealError: string | null = (deal as any).intake_processing_error ?? null;

    // ── Auto-recovery (FIX 2A: actionable for queued_never_started) ─────
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
        const staleRunId: string | undefined = (deal as any).intake_processing_run_id ?? undefined;
        const outcome = await handleStuckRecovery(
          dealId,
          access.bankId,
          verdict,
          staleRunId,
        );

        phase = outcome.phase;
        dealError = outcome.error;
        autoRecovered = outcome.recovered;
        reenqueued = outcome.reenqueued;
      }
    }

    // ── Load latest outbox row for this deal ────────────────────────────
    const { data: outboxRow } = await sb
      .from("buddy_outbox_events")
      .select(
        "id, attempts, delivered_at, delivered_to, last_error, dead_lettered_at, created_at, claim_owner, claimed_at",
      )
      .eq("deal_id", dealId)
      .eq("kind", "intake.process")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const latestOutbox = outboxRow
      ? {
          outbox_id: (outboxRow as any).id,
          attempts: (outboxRow as any).attempts,
          claimed_at: (outboxRow as any).claimed_at,
          claim_owner: (outboxRow as any).claim_owner,
          delivered_at: (outboxRow as any).delivered_at,
          delivered_to: (outboxRow as any).delivered_to,
          last_error: (outboxRow as any).last_error,
          dead_lettered_at: (outboxRow as any).dead_lettered_at,
          created_at: (outboxRow as any).created_at,
        }
      : null;

    // ── Outbox stall detection (idempotent per outbox_id) ────────────
    let outboxStalled = false;
    let stallReasonValue: string | null = null;
    if (
      phase === "CONFIRMED_READY_FOR_PROCESSING" &&
      latestOutbox
    ) {
      const stallVerdict = isOutboxStalled(
        {
          id: latestOutbox.outbox_id,
          attempts: latestOutbox.attempts,
          claimed_at: latestOutbox.claimed_at,
          claim_owner: latestOutbox.claim_owner ?? null,
          delivered_at: latestOutbox.delivered_at,
          dead_lettered_at: latestOutbox.dead_lettered_at,
          created_at: latestOutbox.created_at,
        },
        Date.now(),
      );

      if (stallVerdict.stalled) {
        outboxStalled = true;

        // Fire-and-forget: emit stall event (idempotent per outbox_id)
        void emitOutboxStalledEventIfNeeded({
          dealId,
          outboxId: stallVerdict.outbox_id,
          ageSeconds: stallVerdict.age_seconds,
          runId: (deal as any).intake_processing_run_id ?? null,
          claimOwner: (outboxRow as any).claim_owner ?? null,
        });
      }

      stallReasonValue = stallVerdict.stalled ? stallVerdict.reason : null;
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
        reenqueued,
      },
      latest_outbox: latestOutbox,
      outbox_stalled: outboxStalled,
      stall_reason: stallReasonValue,
    });
  } catch (e: any) {
    rethrowNextErrors(e);
    const correlationId = crypto.randomUUID();
    console.error("[intake/processing-status]", { correlationId, error: e?.message });
    return NextResponse.json(
      {
        ok: false,
        error: e?.message?.slice(0, 300) ?? "unexpected_error",
        correlation_id: correlationId,
      },
      { status: 500 },
    );
  }
}
