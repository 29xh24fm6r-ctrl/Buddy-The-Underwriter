/**
 * Phase E1 — Snapshot Invalidation Helper
 *
 * When a new document is uploaded to a deal that is already in
 * CONFIRMED_READY_FOR_PROCESSING, the snapshot seal is broken.
 *
 * This helper:
 * 1. Resets intake_phase → CLASSIFIED_PENDING_CONFIRMATION
 * 2. Clears intake_snapshot_hash + intake_snapshot_version
 * 3. Unlocks all LOCKED_FOR_PROCESSING docs → AUTO_CONFIRMED
 * 4. Emits intake.snapshot_invalidated_new_upload
 *
 * Fire-and-forget safe: never throws, never partial.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { INTAKE_SNAPSHOT_VERSION } from "@/lib/intake/confirmation/types";

export async function invalidateIntakeSnapshot(
  dealId: string,
  source: string,
): Promise<void> {
  try {
    const sb = supabaseAdmin();

    // Check if deal is in confirmed phase
    const { data: deal, error: dealErr } = await sb
      .from("deals")
      .select("intake_phase")
      .eq("id", dealId)
      .maybeSingle();

    if (dealErr || !deal) return;
    if ((deal as any).intake_phase !== "CONFIRMED_READY_FOR_PROCESSING") return;

    // Reset deal phase + clear snapshot.
    // CAS guard: only succeeds if intake_phase is STILL CONFIRMED_READY_FOR_PROCESSING
    // AND no processing run is active (intake_processing_run_id IS NULL).
    // This prevents late fire-and-forget invalidations from regressing a phase
    // after processing has been stamped with a run_id.
    const { data: updated } = await (sb as any)
      .from("deals")
      .update({
        intake_phase: "CLASSIFIED_PENDING_CONFIRMATION",
        intake_snapshot_hash: null,
        intake_snapshot_version: null,
      })
      .eq("id", dealId)
      .eq("intake_phase", "CONFIRMED_READY_FOR_PROCESSING")
      .is("intake_processing_run_id", null)
      .select("id");

    if (!updated || (updated as any[]).length === 0) {
      // CAS blocked: either phase changed or processing run is active
      void writeEvent({
        dealId,
        kind: "intake.snapshot_invalidation_blocked",
        scope: "intake",
        meta: {
          source,
          reason: "cas_guard_prevented",
          snapshot_version: INTAKE_SNAPSHOT_VERSION,
        },
      });
      return;
    }

    // Unlock all active LOCKED_FOR_PROCESSING docs → AUTO_CONFIRMED
    await (sb as any)
      .from("deal_documents")
      .update({
        intake_status: "AUTO_CONFIRMED",
        intake_locked_at: null,
      })
      .eq("deal_id", dealId)
      .eq("is_active", true)
      .eq("intake_status", "LOCKED_FOR_PROCESSING");

    // Emit event
    void writeEvent({
      dealId,
      kind: "intake.snapshot_invalidated_new_upload",
      scope: "intake",
      meta: {
        source,
        snapshot_version: INTAKE_SNAPSHOT_VERSION,
      },
    });
  } catch {
    // Fire-and-forget: never throws
  }
}
