import "server-only";

/**
 * Phase 55B — Snapshot Promotion
 *
 * Deterministic active-swap: deactivates prior, activates new.
 * A bad build must never replace a usable active snapshot.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import type { FinancialSnapshotStatus } from "./types";

type PromoteInput = {
  dealId: string;
  bankId: string;
  newSnapshotId: string;
  newStatus: FinancialSnapshotStatus;
};

type PromoteResult = {
  promoted: boolean;
  promotedSnapshotId: string;
  priorSnapshotId: string | null;
  promotionReason: string;
  staleMarked: boolean;
};

const PROMOTABLE_STATUSES = new Set<FinancialSnapshotStatus>([
  "generated", "needs_review", "partially_validated", "validated",
]);

/**
 * Promote a new snapshot to active, superseding the prior one.
 * Refuses to promote broken/empty snapshots.
 */
export async function promoteFinancialSnapshot(input: PromoteInput): Promise<PromoteResult> {
  const { dealId, bankId, newSnapshotId, newStatus } = input;
  const sb = supabaseAdmin();
  const now = new Date().toISOString();

  // Guard: don't promote invalid builds
  if (!PROMOTABLE_STATUSES.has(newStatus)) {
    return {
      promoted: false,
      promotedSnapshotId: newSnapshotId,
      priorSnapshotId: null,
      promotionReason: `Status "${newStatus}" is not promotable — preserving prior snapshot`,
      staleMarked: false,
    };
  }

  // Find current active snapshot
  const { data: prior } = await sb
    .from("financial_snapshots_v2")
    .select("id, status")
    .eq("deal_id", dealId)
    .eq("active", true)
    .neq("id", newSnapshotId)
    .maybeSingle();

  // Deactivate prior
  if (prior) {
    await sb
      .from("financial_snapshots_v2")
      .update({
        active: false,
        status: "superseded",
        superseded_by: newSnapshotId,
        updated_at: now,
      })
      .eq("id", prior.id);
  }

  // Activate new
  await sb
    .from("financial_snapshots_v2")
    .update({ active: true, updated_at: now })
    .eq("id", newSnapshotId);

  await logLedgerEvent({
    dealId,
    bankId,
    eventKey: "financial_snapshot.promoted",
    uiState: "done",
    uiMessage: "New financial snapshot activated",
    meta: {
      new_snapshot_id: newSnapshotId,
      prior_snapshot_id: prior?.id ?? null,
      new_status: newStatus,
      prior_status: prior?.status ?? null,
    },
  }).catch(() => {});

  return {
    promoted: true,
    promotedSnapshotId: newSnapshotId,
    priorSnapshotId: prior?.id ?? null,
    promotionReason: prior ? "Superseded prior snapshot" : "First active snapshot",
    staleMarked: prior != null,
  };
}
