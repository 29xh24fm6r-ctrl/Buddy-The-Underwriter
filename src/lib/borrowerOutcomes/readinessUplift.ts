import "server-only";

/**
 * Phase 66C — Readiness Uplift: Measures readiness score improvement over time.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface UpliftSnapshot {
  id: string;
  deal_id: string;
  bank_id: string;
  score_before: number;
  score_after: number;
  uplift: number;
  summary: Record<string, unknown>;
  created_at: string;
}

/**
 * Captures a readiness uplift snapshot.
 */
export async function captureReadinessUplift(
  sb: SupabaseClient,
  dealId: string,
  bankId: string,
  scoreBefore: number,
  scoreAfter: number,
  summary: Record<string, unknown>,
): Promise<void> {
  const { error } = await sb.from("buddy_readiness_uplift_snapshots").insert({
    deal_id: dealId,
    bank_id: bankId,
    score_before: scoreBefore,
    score_after: scoreAfter,
    uplift: scoreAfter - scoreBefore,
    summary,
  });

  if (error)
    throw new Error(`captureReadinessUplift failed: ${error.message}`);
}

/**
 * Returns the uplift history for a deal, newest first.
 */
export async function getUpliftHistory(
  sb: SupabaseClient,
  dealId: string,
): Promise<UpliftSnapshot[]> {
  const { data, error } = await sb
    .from("buddy_readiness_uplift_snapshots")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`getUpliftHistory failed: ${error.message}`);
  return (data ?? []) as UpliftSnapshot[];
}

/**
 * Computes the overall uplift trend from a series of snapshots.
 */
export function computeUpliftTrend(
  snapshots: UpliftSnapshot[],
): { direction: "improving" | "stable" | "declining"; avgUplift: number } {
  if (snapshots.length === 0) {
    return { direction: "stable", avgUplift: 0 };
  }

  const uplifts = snapshots.map((s) => s.uplift);
  const avgUplift = uplifts.reduce((a, b) => a + b, 0) / uplifts.length;

  let direction: "improving" | "stable" | "declining";
  if (avgUplift > 2) {
    direction = "improving";
  } else if (avgUplift < -2) {
    direction = "declining";
  } else {
    direction = "stable";
  }

  return { direction, avgUplift };
}
