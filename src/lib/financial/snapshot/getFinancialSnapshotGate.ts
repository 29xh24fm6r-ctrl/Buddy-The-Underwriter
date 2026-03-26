import "server-only";

/**
 * Phase 55A — Snapshot Gate for Memo / Decision / Pricing
 *
 * Returns whether downstream systems can safely proceed
 * based on the active financial snapshot state.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SnapshotGateResult, FinancialSnapshotStatus } from "./types";

/**
 * Check whether the active financial snapshot supports downstream use.
 */
export async function getFinancialSnapshotGate(dealId: string): Promise<SnapshotGateResult> {
  const sb = supabaseAdmin();

  const { data: snapshot } = await sb
    .from("financial_snapshots_v2")
    .select("id, status, unresolved_conflict_count, missing_fact_count, validated_at")
    .eq("deal_id", dealId)
    .eq("active", true)
    .maybeSingle();

  if (!snapshot) {
    return {
      snapshotPresent: false,
      snapshotStatus: null,
      financialBlockers: ["No active financial snapshot"],
      memoSafe: false,
      decisionSafe: false,
    };
  }

  const status = snapshot.status as FinancialSnapshotStatus;
  const blockers: string[] = [];

  if (status === "not_started" || status === "collecting_inputs") {
    blockers.push("Financial snapshot is not yet complete");
  }
  if (status === "stale") {
    blockers.push("Financial snapshot is stale — newer evidence exists");
  }
  if (status === "superseded") {
    blockers.push("Financial snapshot has been superseded");
  }
  if (snapshot.unresolved_conflict_count > 0) {
    blockers.push(`${snapshot.unresolved_conflict_count} unresolved financial conflict(s)`);
  }
  if (snapshot.missing_fact_count > 0) {
    blockers.push(`${snapshot.missing_fact_count} missing financial fact(s)`);
  }

  const memoSafe = (status === "validated" || status === "partially_validated")
    && snapshot.missing_fact_count === 0
    && !["stale", "superseded"].includes(status);

  const decisionSafe = status === "validated"
    && snapshot.unresolved_conflict_count === 0
    && snapshot.missing_fact_count === 0
    && !["stale", "superseded"].includes(status);

  return {
    snapshotPresent: true,
    snapshotStatus: status,
    financialBlockers: blockers,
    memoSafe,
    decisionSafe,
  };
}
