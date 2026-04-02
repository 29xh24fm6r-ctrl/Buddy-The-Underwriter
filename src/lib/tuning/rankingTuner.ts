/**
 * Ranking Tuner — Phase 66C, System 6
 *
 * Proposes ranking adjustments based on recommendation outcome data.
 * Validates safety before persisting tuning candidates.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TunableDomain } from "./tuningRegistry";
import { getDomainConstraints } from "./tuningRegistry";
import { validateTuningChange } from "./tuningSafetyChecks";

/* ------------------------------------------------------------------ */
/*  proposeRankingTuning                                               */
/* ------------------------------------------------------------------ */

export async function proposeRankingTuning(
  sb: SupabaseClient,
  bankId: string,
  domain: TunableDomain,
): Promise<string | null> {
  const constraints = getDomainConstraints(domain);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  /* Fetch recommendation outcome events */
  const { data: outcomes, error: outErr } = await sb
    .from("buddy_banker_trust_events")
    .select("conclusion_key, event_type, payload")
    .eq("bank_id", bankId)
    .in("event_type", ["acceptance", "rejection", "override"])
    .gte("created_at", since);

  if (outErr || !outcomes || outcomes.length === 0) {
    if (outErr) console.error("[rankingTuner] query failed:", outErr.message);
    return null;
  }

  /* Compute acceptance rate per conclusion_key */
  const keyStats = new Map<string, { accepted: number; total: number }>();

  for (const row of outcomes) {
    const key = row.conclusion_key ?? "unknown";
    let stats = keyStats.get(key);
    if (!stats) {
      stats = { accepted: 0, total: 0 };
      keyStats.set(key, stats);
    }
    stats.total++;
    if (row.event_type === "acceptance") stats.accepted++;
  }

  /* Build proposed ranking adjustments for underperforming conclusions */
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  let hasProposal = false;

  for (const [key, stats] of keyStats) {
    if (stats.total < 3) continue; // skip low-volume conclusions
    const acceptRate = stats.accepted / stats.total;
    const currentRank = 50; // neutral baseline
    before[key] = currentRank;

    if (acceptRate < 0.4) {
      /* Demote — reduce rank within bounds */
      const shift = Math.min(constraints.maxChangePercent / 100 * currentRank, 10);
      after[key] = currentRank - shift;
      hasProposal = true;
    } else if (acceptRate > 0.85) {
      /* Promote — increase rank within bounds */
      const shift = Math.min(constraints.maxChangePercent / 100 * currentRank, 10);
      after[key] = currentRank + shift;
      hasProposal = true;
    } else {
      after[key] = currentRank; // no change
    }
  }

  if (!hasProposal) return null;

  /* Validate safety */
  const check = validateTuningChange(domain, before, after);
  if (!check.safe) {
    console.warn("[rankingTuner] safety check failed:", check.violations);
    return null;
  }

  /* Insert tuning candidate */
  const { data, error } = await sb
    .from("buddy_tuning_candidates")
    .insert({
      bank_id: bankId,
      domain,
      source: "ranking_tuner",
      status: "pending",
      proposed_before: before,
      proposed_after: after,
      change_percent: check.changePercent,
      pattern_key: `ranking::${domain}`,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[rankingTuner] insert failed:", error?.message);
    return null;
  }

  return data.id as string;
}
