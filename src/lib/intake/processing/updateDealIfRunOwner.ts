/**
 * CAS (Compare-And-Swap) helper for deals processing updates.
 *
 * Only mutates the deals row if intake_processing_run_id matches the provided runId.
 * Prevents stale/superseded workers from overwriting current run state.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Update a deal's processing-related columns only if the current run_id matches.
 *
 * @returns true if the row was actually updated (CAS matched), false if superseded.
 * @throws on Supabase transport/query errors (callers should handle).
 *
 * When runId is undefined (pre-observability legacy calls), falls through
 * without CAS to avoid breaking existing flows.
 */
export async function updateDealIfRunOwner(
  dealId: string,
  runId: string | undefined,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const sb = supabaseAdmin();

  if (!runId) {
    // No run_id → legacy path, fall through without CAS
    await (sb as any).from("deals").update(payload).eq("id", dealId);
    return true;
  }

  const { data, error } = await (sb as any)
    .from("deals")
    .update(payload)
    .eq("id", dealId)
    .eq("intake_processing_run_id", runId)
    .select("id");

  if (error) throw error;
  return Array.isArray(data) && data.length === 1;
}
