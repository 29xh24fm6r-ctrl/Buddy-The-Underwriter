/**
 * Server-side emission for outbox stall events.
 *
 * Idempotent per outbox_id: checks deal_events before writing.
 * Emits intake.processing_outbox_stalled with full meta for observability.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { PROCESSING_OBSERVABILITY_VERSION } from "@/lib/intake/constants";
import { OUTBOX_STALL_VERSION } from "./detectOutboxStall";

/**
 * Emit a stalled-outbox event if one hasn't already been emitted for this outbox_id.
 *
 * @returns true if a new event was emitted, false if already emitted or skipped.
 */
export async function emitOutboxStalledEventIfNeeded(args: {
  dealId: string;
  outboxId: string;
  ageSeconds: number;
  runId: string | null;
  claimOwner: string | null;
}): Promise<boolean> {
  const sb = supabaseAdmin();

  // ── Idempotency check: has this outbox_id already been reported? ─────
  try {
    const { data: existing } = await (sb as any)
      .from("deal_events")
      .select("id")
      .eq("deal_id", args.dealId)
      .eq("kind", "intake.processing_outbox_stalled")
      .limit(5);

    // Check meta.outbox_id match (deal_events.meta is JSONB)
    if (existing && existing.length > 0) {
      // Since we can't easily filter JSONB in this query, check if ANY
      // recent stalled event exists for this deal. Conservative: we emit
      // at most one stalled event per deal per stuck cycle.
      // The outbox_id changes on re-enqueue, so a new cycle gets a new event.
      const { data: matchCheck } = await (sb as any)
        .from("deal_events")
        .select("id, meta")
        .eq("deal_id", args.dealId)
        .eq("kind", "intake.processing_outbox_stalled")
        .order("created_at", { ascending: false })
        .limit(1);

      if (matchCheck?.[0]) {
        const meta = matchCheck[0].meta as Record<string, unknown> | null;
        if (meta?.outbox_id === args.outboxId) {
          // Already emitted for this exact outbox row
          return false;
        }
      }
    }
  } catch {
    // If idempotency check fails, emit anyway — better to double-emit than miss
  }

  // ── Emit stalled event ───────────────────────────────────────────────
  await writeEvent({
    dealId: args.dealId,
    kind: "intake.processing_outbox_stalled",
    scope: "intake",
    meta: {
      outbox_id: args.outboxId,
      age_seconds: args.ageSeconds,
      run_id: args.runId,
      claim_owner: args.claimOwner,
      stall_version: OUTBOX_STALL_VERSION,
      observability_version: PROCESSING_OBSERVABILITY_VERSION,
    },
  });

  return true;
}
