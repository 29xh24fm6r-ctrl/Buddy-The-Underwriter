/**
 * Threshold Tuner — Phase 66C, System 6
 *
 * Proposes threshold adjustments for trust, warning suppression, and
 * other bounded domains based on override patterns and feedback.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TunableDomain } from "./tuningRegistry";
import { getDomainConstraints } from "./tuningRegistry";
import { validateTuningChange } from "./tuningSafetyChecks";

/* ------------------------------------------------------------------ */
/*  proposeThresholdTuning                                             */
/* ------------------------------------------------------------------ */

export async function proposeThresholdTuning(
  sb: SupabaseClient,
  bankId: string,
  domain: TunableDomain,
): Promise<string | null> {
  const constraints = getDomainConstraints(domain);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  /* Fetch override events */
  const { data: overrides, error: overErr } = await sb
    .from("buddy_banker_trust_events")
    .select("conclusion_key, payload")
    .eq("bank_id", bankId)
    .eq("event_type", "override")
    .gte("created_at", since);

  if (overErr) {
    console.error("[thresholdTuner] overrides query failed:", overErr.message);
    return null;
  }

  /* Fetch feedback events */
  const { data: feedback, error: fbErr } = await sb
    .from("buddy_feedback_events")
    .select("feedback_type, normalized")
    .eq("bank_id", bankId)
    .gte("created_at", since);

  if (fbErr) {
    console.error("[thresholdTuner] feedback query failed:", fbErr.message);
    return null;
  }

  const overrideCount = overrides?.length ?? 0;
  const feedbackCount = feedback?.length ?? 0;
  const total = overrideCount + feedbackCount;

  if (total < 5) return null; // not enough data

  /* Count negative feedback */
  const negativeFeedback = (feedback ?? []).filter((f) => {
    const norm = f.normalized as { sentiment?: string } | null;
    return norm?.sentiment === "negative";
  }).length;

  /* Propose threshold shift based on override + negative feedback density */
  const negativeDensity = (overrideCount + negativeFeedback) / Math.max(total, 1);

  const currentThreshold = 0.5; // neutral baseline
  const before: Record<string, unknown> = { threshold: currentThreshold };
  const after: Record<string, unknown> = { threshold: currentThreshold };

  if (negativeDensity > 0.4) {
    /* Too many overrides/negatives — raise threshold (more conservative) */
    const maxShift = (constraints.maxChangePercent / 100) * currentThreshold;
    const shift = Math.min(negativeDensity * 0.1, maxShift);
    after.threshold = Math.min(currentThreshold + shift, constraints.maxValue ?? 1);
  } else if (negativeDensity < 0.1) {
    /* Very low override rate — lower threshold (more aggressive) */
    const maxShift = (constraints.maxChangePercent / 100) * currentThreshold;
    const shift = Math.min(0.05, maxShift);
    after.threshold = Math.max(currentThreshold - shift, constraints.minValue ?? 0);
  } else {
    return null; // no change warranted
  }

  /* Validate safety */
  const check = validateTuningChange(domain, before, after);
  if (!check.safe) {
    console.warn("[thresholdTuner] safety check failed:", check.violations);
    return null;
  }

  /* Insert tuning candidate */
  const { data, error } = await sb
    .from("buddy_tuning_candidates")
    .insert({
      bank_id: bankId,
      domain,
      source: "threshold_tuner",
      status: "pending",
      proposed_before: before,
      proposed_after: after,
      change_percent: check.changePercent,
      pattern_key: `threshold::${domain}`,
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[thresholdTuner] insert failed:", error?.message);
    return null;
  }

  return data.id as string;
}
