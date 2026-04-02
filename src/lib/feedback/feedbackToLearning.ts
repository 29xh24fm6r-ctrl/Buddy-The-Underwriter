/**
 * Feedback to Learning — Phase 66C, System 5
 *
 * Converts feedback patterns into tuning candidates by aggregating
 * recent feedback and promoting recurring patterns above a threshold.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/* ------------------------------------------------------------------ */
/*  processFeedbackForLearning                                         */
/* ------------------------------------------------------------------ */

export async function processFeedbackForLearning(
  sb: SupabaseClient,
  bankId: string,
  options?: { minOccurrences?: number },
): Promise<number> {
  const minOccurrences = options?.minOccurrences ?? 5;
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  /* Fetch recent feedback for aggregation */
  const { data: feedback, error: fbErr } = await sb
    .from("buddy_feedback_events")
    .select("feedback_type, normalized")
    .eq("bank_id", bankId)
    .gte("created_at", since);

  if (fbErr || !feedback) {
    console.error("[feedbackToLearning] query failed:", fbErr?.message);
    return 0;
  }

  /* Aggregate by category + feedback_type */
  const patterns = new Map<string, { count: number; feedbackType: string; category: string }>();

  for (const row of feedback) {
    const normalized = row.normalized as { category?: string } | null;
    const category = normalized?.category ?? "unknown";
    const key = `${category}::${row.feedback_type}`;

    const entry = patterns.get(key);
    if (entry) {
      entry.count++;
    } else {
      patterns.set(key, { count: 1, feedbackType: row.feedback_type, category });
    }
  }

  /* Create tuning candidates for patterns exceeding threshold */
  let candidatesCreated = 0;

  for (const [patternKey, { count, feedbackType, category }] of patterns) {
    if (count < minOccurrences) continue;

    /* Check if a candidate already exists for this pattern */
    const { data: existing } = await sb
      .from("buddy_tuning_candidates")
      .select("id")
      .eq("bank_id", bankId)
      .eq("pattern_key", patternKey)
      .eq("status", "pending")
      .limit(1);

    if (existing && existing.length > 0) continue;

    const { error: insertErr } = await sb.from("buddy_tuning_candidates").insert({
      bank_id: bankId,
      pattern_key: patternKey,
      feedback_type: feedbackType,
      category,
      occurrence_count: count,
      status: "pending",
      source: "feedback_aggregation",
    });

    if (insertErr) {
      console.error("[feedbackToLearning] insert candidate failed:", insertErr.message);
      continue;
    }

    candidatesCreated++;
  }

  return candidatesCreated;
}
