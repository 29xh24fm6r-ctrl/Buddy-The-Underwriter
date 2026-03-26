import "server-only";

/**
 * Phase 55A — Mark Active Snapshot Stale
 *
 * Called when new financial evidence arrives that may invalidate
 * the current validated snapshot.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export async function markSnapshotStale(opts: {
  dealId: string;
  bankId: string;
  reason: string;
}): Promise<{ ok: boolean; snapshotId: string | null }> {
  const sb = supabaseAdmin();

  const { data: snapshot } = await sb
    .from("financial_snapshots_v2")
    .select("id")
    .eq("deal_id", opts.dealId)
    .eq("active", true)
    .maybeSingle();

  if (!snapshot) return { ok: true, snapshotId: null };

  await sb
    .from("financial_snapshots_v2")
    .update({ status: "stale", updated_at: new Date().toISOString() })
    .eq("id", snapshot.id);

  await logLedgerEvent({
    dealId: opts.dealId,
    bankId: opts.bankId,
    eventKey: "financial_snapshot.marked_stale",
    uiState: "waiting",
    uiMessage: "Financial snapshot marked stale",
    meta: { snapshot_id: snapshot.id, reason: opts.reason },
  }).catch(() => {});

  return { ok: true, snapshotId: snapshot.id };
}
