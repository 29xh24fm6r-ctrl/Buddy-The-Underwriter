/**
 * Drain pipeline notification events from buddy_outbox_events to Pulse.
 *
 * Handles: checklist_reconciled, readiness_recomputed, artifact_processed,
 * manual_override, and any other non-intake outbox events.
 *
 * Uses the same claim/deliver pattern as processIntakeOutbox.
 * Never throws. Called by /api/workers/pulse-outbox (Vercel Cron, every 2 min).
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { hasOutboxWork } from "@/lib/workers/idleProbe";

// Event kinds handled by intake-outbox worker — skip these
const INTAKE_KINDS = new Set(["intake.process"]);
const INTAKE_KINDS_LIST = Array.from(INTAKE_KINDS);

const DEAD_LETTER_THRESHOLD = 10;
const BACKOFF_BASE_SECONDS = 60;
const BACKOFF_CAP_SECONDS = 3600;
const INGEST_TIMEOUT_MS = 20000;

export type PulseOutboxResult = {
  claimed: number;
  forwarded: number;
  failed: number;
  dead_lettered: number;
  skipped_disabled: boolean;
  idle?: boolean;
};

function backoffSeconds(attempts: number): number {
  return Math.min(
    Math.pow(2, attempts) * BACKOFF_BASE_SECONDS,
    BACKOFF_CAP_SECONDS,
  );
}

export async function processPulseOutbox(
  maxRows = 50,
): Promise<PulseOutboxResult> {
  // Kill switch — same pattern as forwardLedgerCore
  if (process.env.PULSE_TELEMETRY_ENABLED !== "true") {
    return {
      claimed: 0,
      forwarded: 0,
      failed: 0,
      dead_lettered: 0,
      skipped_disabled: true,
    };
  }

  const ingestUrl = process.env.PULSE_BUDDY_INGEST_URL;
  const ingestToken = process.env.PULSE_INGEST_TOKEN;
  if (!ingestUrl || !ingestToken) {
    return {
      claimed: 0,
      forwarded: 0,
      failed: 0,
      dead_lettered: 0,
      skipped_disabled: true,
    };
  }

  const sb = supabaseAdmin();

  // ── Idle probe: cheap LIMIT 1 existence check before opening claim path ──────
  // If there is no eligible non-intake row, return immediately without writing
  // a heartbeat or starting a claim transaction. This is the bulk of cron
  // invocations and used to be the source of millions of identical claim
  // queries against pg_stat_statements.
  const work = await hasOutboxWork({ sb, excludeKinds: INTAKE_KINDS_LIST });
  if (!work) {
    if (process.env.DEBUG_WORKERS === "true") {
      console.log("[pulse-outbox] idle_no_work");
    }
    return {
      claimed: 0,
      forwarded: 0,
      failed: 0,
      dead_lettered: 0,
      skipped_disabled: false,
      idle: true,
    };
  }

  const claimOwner = `pulse-outbox-${Date.now()}`;
  const now = new Date().toISOString();

  // ── Step 0: Reclaim stale claims (claimed > 10 min ago, never delivered) ──────
  const staleThreshold = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  await (sb as any)
    .from("buddy_outbox_events")
    .update({ claimed_at: null, claim_owner: null })
    .lt("claimed_at", staleThreshold)
    .is("delivered_at", null)
    .is("dead_lettered_at", null);

  // Select unclaimed, undelivered, non-intake events
  const { data: candidates, error: selectErr } = await (sb as any)
    .from("buddy_outbox_events")
    .select("id, kind, deal_id, bank_id, payload, attempts")
    .is("delivered_at", null)
    .is("dead_lettered_at", null)
    .is("claimed_at", null)
    .or("next_attempt_at.is.null,next_attempt_at.lte." + now)
    .order("created_at", { ascending: true })
    .limit(maxRows);

  if (selectErr || !candidates || candidates.length === 0) {
    return {
      claimed: 0,
      forwarded: 0,
      failed: 0,
      dead_lettered: 0,
      skipped_disabled: false,
    };
  }

  // Filter out intake events
  const filtered = (candidates as any[]).filter(
    (r) => !INTAKE_KINDS.has(r.kind),
  );

  if (filtered.length === 0) {
    return {
      claimed: 0,
      forwarded: 0,
      failed: 0,
      dead_lettered: 0,
      skipped_disabled: false,
    };
  }

  // Claim atomically
  const claimed: any[] = [];
  for (const candidate of filtered) {
    const { data } = await (sb as any)
      .from("buddy_outbox_events")
      .update({ claimed_at: now, claim_owner: claimOwner })
      .eq("id", candidate.id)
      .is("claimed_at", null)
      .select("id, kind, deal_id, bank_id, payload, attempts")
      .maybeSingle();
    if (data) claimed.push(data);
  }

  if (claimed.length === 0) {
    return {
      claimed: 0,
      forwarded: 0,
      failed: 0,
      dead_lettered: 0,
      skipped_disabled: false,
    };
  }

  let forwarded = 0;
  let failed = 0;
  let deadLettered = 0;

  for (const row of claimed) {
    const ingestPayload = {
      event_code: row.kind,
      deal_id: row.deal_id ?? null,
      bank_id: row.bank_id ?? null,
      actor_id: null,
      status: "success",
      payload: row.payload ?? {},
      emitted_at: new Date().toISOString(),
    };

    try {
      const res = await fetch(ingestUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ingestToken}`,
        },
        body: JSON.stringify(ingestPayload),
        signal: AbortSignal.timeout(INGEST_TIMEOUT_MS),
      });

      if (res.ok) {
        await (sb as any)
          .from("buddy_outbox_events")
          .update({
            delivered_at: new Date().toISOString(),
            delivered_to: "pulse",
            claimed_at: null,
            claim_owner: null,
            last_error: null,
          })
          .eq("id", row.id);
        forwarded++;
      } else {
        const isDeadLetter = await markFailed(
          sb,
          row.id,
          `HTTP ${res.status}`,
          row.attempts,
        );
        if (isDeadLetter) deadLettered++;
        failed++;
      }
    } catch (err: any) {
      const isDeadLetter = await markFailed(
        sb,
        row.id,
        err?.message?.slice(0, 200) ?? "unknown",
        row.attempts,
      );
      if (isDeadLetter) deadLettered++;
      failed++;
    }
  }

  return {
    claimed: claimed.length,
    forwarded,
    failed,
    dead_lettered: deadLettered,
    skipped_disabled: false,
  };
}

async function markFailed(
  sb: ReturnType<typeof supabaseAdmin>,
  rowId: string,
  error: string,
  currentAttempts: number,
): Promise<boolean> {
  const newAttempts = (currentAttempts ?? 0) + 1;
  const isDeadLetter = newAttempts >= DEAD_LETTER_THRESHOLD;

  const update: Record<string, unknown> = {
    attempts: newAttempts,
    last_error: error.slice(0, 500),
    claimed_at: null,
    claim_owner: null,
  };

  if (isDeadLetter) {
    update.dead_lettered_at = new Date().toISOString();
  } else {
    update.next_attempt_at = new Date(
      Date.now() + backoffSeconds(newAttempts) * 1000,
    ).toISOString();
  }

  await (sb as any)
    .from("buddy_outbox_events")
    .update(update)
    .eq("id", rowId);

  return isDeadLetter;
}
