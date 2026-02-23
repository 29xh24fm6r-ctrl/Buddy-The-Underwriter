/**
 * Fire-and-forget heartbeat stamp on the deals row during processing.
 *
 * CAS guard on run_id prevents stale heartbeats from a superseded run.
 * Never throws — callers use `void stampProcessingHeartbeat(...)`.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

export async function stampProcessingHeartbeat(
  dealId: string,
  runId: string,
  step: string,
): Promise<void> {
  try {
    const sb = supabaseAdmin();
    await (sb as any)
      .from("deals")
      .update({
        intake_processing_last_heartbeat_at: new Date().toISOString(),
      })
      .eq("id", dealId)
      .eq("intake_processing_run_id", runId);

    console.log("[intake.heartbeat]", { dealId, step });
  } catch {
    // Fire-and-forget: never throws
  }
}
