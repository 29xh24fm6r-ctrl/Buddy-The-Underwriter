import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchMemoHashInputs } from "@/lib/creditMemo/canonical/fetchMemoHashInputs";
import { computeMemoInputHash } from "@/lib/creditMemo/canonical/memoProvenance";

export async function computeTridentInputHash(
  sb: SupabaseClient,
  dealId: string,
): Promise<string> {
  return computeMemoInputHash(await fetchMemoHashInputs(sb, dealId));
}

/**
 * Durable Trident runs are bound to the exact canonical inputs admitted by
 * acquire_trident_bundle_run. Every expensive stage checks this boundary
 * before work and again before release so mutable deal state can never be
 * mixed into one supposedly deterministic package.
 */
export async function assertTridentInputSnapshot(args: {
  sb: SupabaseClient;
  dealId: string;
  expectedHash: string;
}): Promise<void> {
  const currentHash = await computeTridentInputHash(args.sb, args.dealId);
  if (currentHash !== args.expectedHash) {
    throw new Error(
      `input_snapshot_changed: admitted=${args.expectedHash} current=${currentHash}`,
    );
  }
}
