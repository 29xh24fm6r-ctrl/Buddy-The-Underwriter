/**
 * Server-side self-healing for stuck intake processing deals.
 *
 * Runs on a 3-minute cron. Three recovery checks:
 *
 *   A) Confirmed deals with no live outbox row → re-enqueue
 *   B) Long-stalled claimed rows → emit observability event (claim RPC reclaims naturally)
 *   C) Dead-lettered rows whose deal is still confirmed → re-enqueue fresh row
 *
 * Invariants:
 *   - NEVER imports runIntakeProcessing or processConfirmedIntake
 *   - NEVER mutates deal phase directly
 *   - All recovery enters through insertOutboxEvent
 *   - Rate-limited: skips deal if any intake.process outbox row created in last 10 min
 *   - Idempotent: safe to overlap or double-fire
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { insertOutboxEvent } from "@/lib/outbox/insertOutboxEvent";
import { writeEvent } from "@/lib/ledger/writeEvent";

/** Max deals to recover per invocation to bound execution time. */
const MAX_RECOVERIES_PER_RUN = 20;

/** Cooldown: skip deal if an intake.process outbox row was created within this window. */
const RATE_LIMIT_MINUTES = 10;

/** Claimed rows older than this are eligible for reclaim by the claim RPC. */
const STALE_CLAIM_SECONDS = 180;

export type RecoveryResult = {
  reenqueued_no_live_row: number;
  reenqueued_dead_letter: number;
  reclaim_eligible: number;
  skipped_rate_limited: number;
};

export async function recoverStuckIntakeDeals(): Promise<RecoveryResult> {
  const sb = supabaseAdmin();
  const result: RecoveryResult = {
    reenqueued_no_live_row: 0,
    reenqueued_dead_letter: 0,
    reclaim_eligible: 0,
    skipped_rate_limited: 0,
  };

  // ── A) Confirmed deals with no live outbox row ───────────────────────
  // A "live" row = not delivered AND not dead-lettered.
  // If no live row exists, the consumer has nothing to pick up → stuck.
  const { data: orphanedDeals, error: orphanErr } = await sb.rpc(
    "find_confirmed_deals_without_live_outbox",
    { p_limit: MAX_RECOVERIES_PER_RUN },
  );

  if (orphanErr) {
    console.error("[intake-recovery] orphan query failed:", orphanErr.message);
  } else if (orphanedDeals?.length) {
    for (const deal of orphanedDeals) {
      const rateLimited = await isRateLimited(sb, deal.id);
      if (rateLimited) {
        result.skipped_rate_limited++;
        continue;
      }

      const newRunId = crypto.randomUUID();

      // Reset run markers via direct update (no CAS — there's no active run to protect)
      await sb
        .from("deals")
        .update({
          intake_processing_queued_at: new Date().toISOString(),
          intake_processing_started_at: null,
          intake_processing_run_id: newRunId,
          intake_processing_last_heartbeat_at: null,
          intake_processing_error: null,
        })
        .eq("id", deal.id)
        .eq("intake_phase", "CONFIRMED_READY_FOR_PROCESSING");

      await insertOutboxEvent({
        kind: "intake.process",
        dealId: deal.id,
        bankId: deal.bank_id,
        payload: {
          deal_id: deal.id,
          run_id: newRunId,
          reason: "server_recovery_no_live_row",
        },
      });

      void writeEvent({
        dealId: deal.id,
        kind: "intake.processing_server_recovery",
        scope: "intake",
        meta: {
          recovery_type: "no_live_row",
          new_run_id: newRunId,
          recovery_version: "recovery_v1",
        },
      });

      result.reenqueued_no_live_row++;
    }
  }

  // ── B) Long-stalled claimed rows → observability only ────────────────
  // The claim RPC already reclaims rows where claimed_at > 120s.
  // We just emit a ledger event for visibility at the 180s mark.
  const { data: staleClaimed, error: staleErr } = await sb
    .from("buddy_outbox_events")
    .select("id, deal_id")
    .eq("kind", "intake.process")
    .is("delivered_at", null)
    .is("dead_lettered_at", null)
    .lt("claimed_at", new Date(Date.now() - STALE_CLAIM_SECONDS * 1000).toISOString())
    .limit(MAX_RECOVERIES_PER_RUN);

  if (staleErr) {
    console.error("[intake-recovery] stale claim query failed:", staleErr.message);
  } else if (staleClaimed?.length) {
    for (const row of staleClaimed) {
      void writeEvent({
        dealId: row.deal_id,
        kind: "intake.processing_reclaim_eligible",
        scope: "intake",
        meta: {
          outbox_id: row.id,
          recovery_version: "recovery_v1",
        },
      });
      result.reclaim_eligible++;
    }
  }

  // ── C) Dead-lettered rows whose deal is still confirmed ──────────────
  // After 5 failures the outbox row is dead-lettered. If the deal is still
  // CONFIRMED, nobody else is going to fix it. Insert a fresh outbox row.
  const { data: deadLettered, error: dlErr } = await sb.rpc(
    "find_dead_lettered_confirmed_deals",
    { p_limit: MAX_RECOVERIES_PER_RUN },
  );

  if (dlErr) {
    console.error("[intake-recovery] dead-letter query failed:", dlErr.message);
  } else if (deadLettered?.length) {
    for (const deal of deadLettered) {
      const rateLimited = await isRateLimited(sb, deal.id);
      if (rateLimited) {
        result.skipped_rate_limited++;
        continue;
      }

      const newRunId = crypto.randomUUID();

      await sb
        .from("deals")
        .update({
          intake_processing_queued_at: new Date().toISOString(),
          intake_processing_started_at: null,
          intake_processing_run_id: newRunId,
          intake_processing_last_heartbeat_at: null,
          intake_processing_error: null,
        })
        .eq("id", deal.id)
        .eq("intake_phase", "CONFIRMED_READY_FOR_PROCESSING");

      await insertOutboxEvent({
        kind: "intake.process",
        dealId: deal.id,
        bankId: deal.bank_id,
        payload: {
          deal_id: deal.id,
          run_id: newRunId,
          reason: "server_recovery_dead_letter",
        },
      });

      void writeEvent({
        dealId: deal.id,
        kind: "intake.processing_dead_letter_recovered",
        scope: "intake",
        meta: {
          recovery_type: "dead_letter",
          new_run_id: newRunId,
          recovery_version: "recovery_v1",
        },
      });

      result.reenqueued_dead_letter++;
    }
  }

  console.log("[intake-recovery] complete", result);
  return result;
}

// ── Rate limiter ──────────────────────────────────────────────────────────

async function isRateLimited(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - RATE_LIMIT_MINUTES * 60 * 1000).toISOString();
  const { data } = await sb
    .from("buddy_outbox_events")
    .select("id")
    .eq("deal_id", dealId)
    .eq("kind", "intake.process")
    .gte("created_at", cutoff)
    .limit(1);

  return Array.isArray(data) && data.length > 0;
}
