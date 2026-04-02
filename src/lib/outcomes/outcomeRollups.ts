import "server-only";

/**
 * Phase 66C — Outcome Rollups: Aggregates outcome events into metrics.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { OutcomeMetric, OutcomeMetricKey } from "./outcomeMetrics";
import { computeRate, computeLift } from "./outcomeMetrics";

interface RollupRow {
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

interface RecOutcomeRow {
  status: string;
  usefulness: number | null;
  timing: string | null;
  impact: string | null;
  overridden: boolean;
}

function metric(
  key: OutcomeMetricKey,
  value: number,
  unit: string,
  direction: "higher_better" | "lower_better",
  benchmark?: number,
): OutcomeMetric {
  return { key, value, unit, direction, benchmark };
}

function avgOrZero(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * Computes all 14 outcome metrics for a single deal.
 */
export async function rollupDealOutcomes(
  sb: SupabaseClient,
  dealId: string,
  bankId: string,
): Promise<OutcomeMetric[]> {
  const [eventsRes, recOutcomesRes] = await Promise.all([
    sb
      .from("buddy_outcome_events")
      .select("event_type, payload, created_at")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId),
    sb
      .from("buddy_recommendation_outcomes")
      .select("status, usefulness, timing, impact, overridden")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId),
  ]);

  const events: RollupRow[] = (eventsRes.data ?? []) as RollupRow[];
  const recOutcomes: RecOutcomeRow[] =
    (recOutcomesRes.data ?? []) as RecOutcomeRow[];

  const timeEvents = (type: string): number[] =>
    events
      .filter((e) => e.event_type === type && e.payload?.duration_ms != null)
      .map((e) => e.payload.duration_ms as number);

  const totalRecs = recOutcomes.length;
  const accepted = recOutcomes.filter((r) => r.status === "accepted").length;
  const overridden = recOutcomes.filter((r) => r.overridden).length;
  const usefulnessScores = recOutcomes
    .filter((r) => r.usefulness != null)
    .map((r) => r.usefulness!);

  const borrowerActions = events.filter(
    (e) => e.event_type === "borrower_action",
  );
  const completedActions = borrowerActions.filter(
    (e) => e.payload?.status === "completed",
  );

  const recomputeEvents = events.filter(
    (e) => e.event_type === "recompute_check",
  );
  const avoided = recomputeEvents.filter(
    (e) => e.payload?.avoided === true,
  ).length;

  const falseWarnings = events.filter(
    (e) => e.event_type === "false_warning",
  ).length;
  const totalWarnings = events.filter(
    (e) => e.event_type === "warning" || e.event_type === "false_warning",
  ).length;

  const staleGuidance = events.filter(
    (e) => e.event_type === "stale_guidance",
  ).length;
  const totalGuidance = events.filter(
    (e) =>
      e.event_type === "guidance_issued" || e.event_type === "stale_guidance",
  ).length;

  const readinessEvents = events.filter(
    (e) => e.event_type === "readiness_snapshot",
  );
  const readinessBefore =
    (readinessEvents[readinessEvents.length - 1]?.payload
      ?.score_before as number) ?? 0;
  const readinessAfter =
    (readinessEvents[0]?.payload?.score_after as number) ?? 0;

  const conversionEvents = events.filter(
    (e) => e.event_type === "conversion_snapshot",
  );
  const convBefore =
    (conversionEvents[conversionEvents.length - 1]?.payload
      ?.rate_before as number) ?? 0;
  const convAfter =
    (conversionEvents[0]?.payload?.rate_after as number) ?? 0;

  return [
    metric(
      "time_to_research_completion",
      avgOrZero(timeEvents("research_completed")),
      "ms",
      "lower_better",
    ),
    metric(
      "time_to_memo",
      avgOrZero(timeEvents("memo_generated")),
      "ms",
      "lower_better",
    ),
    metric(
      "time_to_borrower_readiness",
      avgOrZero(timeEvents("borrower_ready")),
      "ms",
      "lower_better",
    ),
    metric(
      "doc_turnaround_speed",
      avgOrZero(timeEvents("doc_turnaround")),
      "ms",
      "lower_better",
    ),
    metric(
      "recommendation_acceptance_rate",
      computeRate(accepted, totalRecs),
      "ratio",
      "higher_better",
      0.7,
    ),
    metric(
      "borrower_action_completion_rate",
      computeRate(completedActions.length, borrowerActions.length),
      "ratio",
      "higher_better",
      0.6,
    ),
    metric(
      "recompute_avoidance_rate",
      computeRate(avoided, recomputeEvents.length),
      "ratio",
      "higher_better",
    ),
    metric(
      "banker_trust_score",
      avgOrZero(usefulnessScores),
      "score",
      "higher_better",
      4.0,
    ),
    metric(
      "borrower_usefulness_score",
      avgOrZero(
        events
          .filter(
            (e) =>
              e.event_type === "borrower_feedback" &&
              e.payload?.score != null,
          )
          .map((e) => e.payload.score as number),
      ),
      "score",
      "higher_better",
      4.0,
    ),
    metric(
      "deal_conversion_lift",
      computeLift(convBefore, convAfter),
      "percent",
      "higher_better",
    ),
    metric(
      "readiness_lift",
      computeLift(readinessBefore, readinessAfter),
      "percent",
      "higher_better",
    ),
    metric("override_rate", computeRate(overridden, totalRecs), "ratio", "lower_better", 0.15),
    metric(
      "false_warning_rate",
      computeRate(falseWarnings, totalWarnings),
      "ratio",
      "lower_better",
      0.1,
    ),
    metric(
      "stale_guidance_rate",
      computeRate(staleGuidance, totalGuidance),
      "ratio",
      "lower_better",
      0.1,
    ),
  ];
}

/**
 * Bank-wide outcome aggregation across all deals.
 */
export async function rollupBankOutcomes(
  sb: SupabaseClient,
  bankId: string,
): Promise<OutcomeMetric[]> {
  const { data: deals, error } = await sb
    .from("buddy_outcome_events")
    .select("deal_id")
    .eq("bank_id", bankId);

  if (error) throw new Error(`rollupBankOutcomes failed: ${error.message}`);

  const uniqueDealIds = [...new Set((deals ?? []).map((d) => d.deal_id))];
  if (uniqueDealIds.length === 0) return [];

  const allMetrics = await Promise.all(
    uniqueDealIds.map((dealId) => rollupDealOutcomes(sb, dealId, bankId)),
  );

  // Average each metric key across deals
  const byKey = new Map<OutcomeMetricKey, OutcomeMetric[]>();
  for (const dealMetrics of allMetrics) {
    for (const m of dealMetrics) {
      if (!byKey.has(m.key)) byKey.set(m.key, []);
      byKey.get(m.key)!.push(m);
    }
  }

  const averaged: OutcomeMetric[] = [];
  for (const [key, metrics] of byKey.entries()) {
    const avg = avgOrZero(metrics.map((m) => m.value));
    averaged.push({
      key,
      value: avg,
      unit: metrics[0].unit,
      direction: metrics[0].direction,
      benchmark: metrics[0].benchmark,
    });
  }

  return averaged;
}
