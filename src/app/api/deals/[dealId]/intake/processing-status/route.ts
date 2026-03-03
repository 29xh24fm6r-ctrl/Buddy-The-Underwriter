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
    let intakeProcessingStalled = false;
    let intakeStalledSinceSeconds: number | null = null;
    let intakeStallReason: string | null = null;

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
        // Surface stall state before recovery mutates phase
        intakeProcessingStalled = true;
        intakeStalledSinceSeconds = Math.round(verdict.age_ms / 1000);
        intakeStallReason = verdict.reason;

        // Fire-and-forget: emit processing stall ledger event (distinct from outbox stall)
        void import("@/lib/ledger/writeEvent").then(({ writeEvent }) =>
          writeEvent({
            dealId,
            kind: "intake.processing_stalled",
            meta: {
              reason: verdict.reason,
              age_seconds: intakeStalledSinceSeconds,
              run_id: (deal as any).intake_processing_run_id ?? null,
            },
          }).catch(() => {}),
        );

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

        // Fire-and-forget: emit recovery event when a stall is actually recovered (forward progress)
        if (outcome.recovered) {
          void import("@/lib/ledger/writeEvent").then(({ writeEvent }) =>
            writeEvent({
              dealId,
              kind: "intake.processing_recovered",
              meta: {
                recovered_from_reason: verdict.reason,
                stalled_seconds: Math.round(verdict.age_ms / 1000),
                run_id: (deal as any).intake_processing_run_id ?? null,
                reenqueued: outcome.reenqueued,
              },
            }).catch(() => {}),
          );
        }
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

    // ── Spread-run SLA watchdog ─────────────────────────────────────
    // Detect a deal_spread_runs row stuck in "queued" or "running" beyond 5 minutes.
    // Fires once per poll; event is idempotent (fire-and-forget).
    const SPREAD_RUN_SLA_MS = 5 * 60 * 1000; // 5 minutes
    let spreadRunStalled = false;
    let stalledSpreadRunId: string | null = null;

    const { data: spreadRunRow } = await (sb as any)
      .from("deal_spread_runs")
      .select("id, status, created_at")
      .eq("deal_id", dealId)
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (spreadRunRow) {
      const runAgeMs = Date.now() - new Date((spreadRunRow as any).created_at).getTime();
      if (runAgeMs > SPREAD_RUN_SLA_MS) {
        spreadRunStalled = true;
        stalledSpreadRunId = (spreadRunRow as any).id;
        // Fire-and-forget stall event (no dedup needed — polling will see it each cycle)
        void import("@/lib/ledger/writeEvent").then(({ writeEvent }) =>
          writeEvent({
            dealId,
            kind: "spread_run_stalled",
            meta: {
              run_id: stalledSpreadRunId,
              status: (spreadRunRow as any).status,
              age_seconds: Math.round(runAgeMs / 1000),
            },
          }).catch(() => {}),
        );
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
        reenqueued,
      },
      latest_outbox: latestOutbox,
      outbox_stalled: outboxStalled,
      stall_reason: stallReasonValue,
      spread_run_stalled: spreadRunStalled,
      stalled_spread_run_id: stalledSpreadRunId,
      intake_processing_stalled: intakeProcessingStalled,
      intake_stall_reason: intakeStallReason,
      stalled_since_seconds: intakeStalledSinceSeconds,
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
