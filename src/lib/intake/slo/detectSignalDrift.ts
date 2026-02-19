/**
 * Detect Signal Drift — Intake Signal Intelligence Monitor (Phase D)
 *
 * Measures week-over-week drift in two intake signal dimensions:
 *   1. Global LLM fallback % — spike > SIGNAL_LLM_FALLBACK_DRIFT_THRESHOLD
 *   2. Per-doc-type avg_confidence — drop > SIGNAL_CONFIDENCE_DROP_THRESHOLD
 *      (top SIGNAL_TOP_DOC_TYPES_COUNT types by volume)
 *
 * Requires sample_size >= SIGNAL_MIN_SAMPLE_SIZE to emit (avoids false positives
 * from low-traffic periods).
 *
 * Deduplication: at most one event per drift_type per 24h.
 *
 * Called from: observer tick / ops cron
 * Fire-and-forget: never throws, always swallows errors.
 *
 * Architecture: accepts injected Supabase client — no direct supabaseAdmin()
 * call inside this function. All SQL in private query helpers (Guard 10).
 * Every emitted event includes full window metadata for audit trail stability.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { writeEvent } from "@/lib/ledger/writeEvent";

// Pure constants and helpers live in signalDriftPure.ts so CI guards can
// import them without pulling in writeEvent → server-only transitively.
export {
  SIGNAL_DETECTION_VERSION,
  SIGNAL_LLM_FALLBACK_DRIFT_THRESHOLD,
  SIGNAL_CONFIDENCE_DROP_THRESHOLD,
  SIGNAL_TOP_DOC_TYPES_COUNT,
  SIGNAL_MIN_SAMPLE_SIZE,
  SIGNAL_DRIFT_EXPECTED_ARITY,
  computeLlmFallbackPct,
} from "@/lib/intake/slo/signalDriftPure";

import {
  SIGNAL_DETECTION_VERSION,
  SIGNAL_LLM_FALLBACK_DRIFT_THRESHOLD,
  SIGNAL_CONFIDENCE_DROP_THRESHOLD,
  SIGNAL_TOP_DOC_TYPES_COUNT,
  SIGNAL_MIN_SAMPLE_SIZE,
  computeLlmFallbackPct,
} from "@/lib/intake/slo/signalDriftPure";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SourceMixRow = {
  match_source: string;
  doc_count: number;
  avg_confidence: number | null;
};

type DocTypeConfidenceRow = {
  effective_doc_type: string;
  doc_count: number;
  avg_confidence: number | null;
};

// ---------------------------------------------------------------------------
// Private query helpers (Guard 10 — no direct SQL in drift logic)
// ---------------------------------------------------------------------------

/**
 * Query source mix for a given time window.
 * Returns null on error (fire-and-forget caller handles it).
 */
async function querySourceMix(
  sb: SupabaseClient,
  windowStart: Date,
  windowEnd: Date,
): Promise<SourceMixRow[] | null> {
  const { data, error } = await (sb as any)
    .from("deal_documents")
    .select("match_source, classification_confidence")
    .not("finalized_at", "is", null)
    .gte("created_at", windowStart.toISOString())
    .lt("created_at", windowEnd.toISOString());

  if (error) {
    console.warn("[detectSignalDrift] source mix query error:", error);
    return null;
  }

  if (!data || data.length === 0) return [];

  // Aggregate in JS — view-level aggregation not available via .from() filters
  const bySource: Record<string, { count: number; confSum: number; confN: number }> = {};
  for (const row of data) {
    const src = row.match_source ?? "unknown";
    if (!bySource[src]) bySource[src] = { count: 0, confSum: 0, confN: 0 };
    bySource[src].count += 1;
    if (row.classification_confidence != null) {
      bySource[src].confSum += Number(row.classification_confidence);
      bySource[src].confN += 1;
    }
  }

  return Object.entries(bySource).map(([match_source, v]) => ({
    match_source,
    doc_count: v.count,
    avg_confidence: v.confN > 0 ? v.confSum / v.confN : null,
  }));
}

/**
 * Query top-N doc types by volume with their avg_confidence.
 * Returns null on error.
 */
async function queryTopDocTypeConfidence(
  sb: SupabaseClient,
  windowStart: Date,
  windowEnd: Date,
  topN: number,
): Promise<DocTypeConfidenceRow[] | null> {
  const { data, error } = await (sb as any)
    .from("deal_documents")
    .select("effective_doc_type, classification_confidence")
    .not("finalized_at", "is", null)
    .not("classification_confidence", "is", null)
    .gte("created_at", windowStart.toISOString())
    .lt("created_at", windowEnd.toISOString());

  if (error) {
    console.warn("[detectSignalDrift] doc type confidence query error:", error);
    return null;
  }

  if (!data || data.length === 0) return [];

  // Aggregate by effective_doc_type
  const byType: Record<string, { count: number; confSum: number }> = {};
  for (const row of data) {
    const t = row.effective_doc_type ?? "unknown";
    if (!byType[t]) byType[t] = { count: 0, confSum: 0 };
    byType[t].count += 1;
    byType[t].confSum += Number(row.classification_confidence);
  }

  return Object.entries(byType)
    .map(([effective_doc_type, v]) => ({
      effective_doc_type,
      doc_count: v.count,
      avg_confidence: v.count > 0 ? v.confSum / v.count : null,
    }))
    .sort((a, b) => b.doc_count - a.doc_count)
    .slice(0, topN);
}

/**
 * Check if a drift event for this drift_type was already emitted in the last 24h.
 * Returns true if dedup should suppress the emit.
 */
async function isDriftAlreadyEmitted(
  sb: SupabaseClient,
  driftType: string,
): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await (sb as any)
    .from("deal_events")
    .select("id")
    .eq("kind", "intake.signal_drift_detected")
    .eq("deal_id", "system")
    .gte("created_at", since)
    .limit(1);

  if (error) {
    // On error, allow emit (fail open — better to over-emit than miss a drift)
    return false;
  }

  if (!data || data.length === 0) return false;

  // Further filter by drift_type in meta — check if any result has matching drift_type
  // Since supabase JS doesn't support JSON path filtering in .eq on JSONB easily,
  // we fetched recent ones and check manually. Already limited to 1.
  // Note: The query above gets ANY recent signal drift event — we need per-type check.
  // Re-query with more specificity is cleaner.
  return false; // The re-query below handles the real check
}

/**
 * Check dedup properly: any signal_drift_detected with matching drift_type in last 24h.
 */
async function hasDriftEventForType(
  sb: SupabaseClient,
  driftType: string,
  docType?: string,
): Promise<boolean> {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    // Query recent system events and check meta in JS — JSONB path filtering
    // varies by Supabase client version
    const { data, error } = await (sb as any)
      .from("deal_events")
      .select("meta")
      .eq("kind", "intake.signal_drift_detected")
      .eq("deal_id", "system")
      .gte("created_at", since);

    if (error || !data) return false;

    return (data as Array<{ meta: any }>).some((row) => {
      if (!row.meta) return false;
      if (row.meta.drift_type !== driftType) return false;
      if (docType !== undefined && row.meta.doc_type !== docType) return false;
      return true;
    });
  } catch {
    return false; // fail open
  }
}

// ---------------------------------------------------------------------------
// detectSignalDrift — injected dependency, fire-and-forget
// ---------------------------------------------------------------------------

/**
 * Detects week-over-week signal drift in LLM fallback % and per-type confidence.
 * Accepts a Supabase client as an injected dependency (no supabaseAdmin() inside).
 * Fire-and-forget — never throws.
 */
export async function detectSignalDrift(sb: SupabaseClient): Promise<void> {
  try {
    const now = new Date();

    // Define windows: this week = last 7 days, prev week = 8-14 days ago
    const thisWeekEnd = now;
    const thisWeekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const prevWeekEnd = thisWeekStart;
    const prevWeekStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    // ---------------------------------------------------------------------------
    // Check 1: LLM fallback % drift
    // ---------------------------------------------------------------------------

    const [thisSourceMix, prevSourceMix] = await Promise.all([
      querySourceMix(sb, thisWeekStart, thisWeekEnd),
      querySourceMix(sb, prevWeekStart, prevWeekEnd),
    ]);

    if (thisSourceMix !== null && prevSourceMix !== null) {
      const thisTotal = thisSourceMix.reduce((s, r) => s + r.doc_count, 0);
      const prevTotal = prevSourceMix.reduce((s, r) => s + r.doc_count, 0);

      if (
        thisTotal >= SIGNAL_MIN_SAMPLE_SIZE &&
        prevTotal >= SIGNAL_MIN_SAMPLE_SIZE
      ) {
        const thisFallbackPct = computeLlmFallbackPct(thisSourceMix);
        const prevFallbackPct = computeLlmFallbackPct(prevSourceMix);
        const delta = thisFallbackPct - prevFallbackPct;

        if (delta > SIGNAL_LLM_FALLBACK_DRIFT_THRESHOLD) {
          const alreadyEmitted = await hasDriftEventForType(
            sb,
            "llm_fallback_spike",
          );

          if (!alreadyEmitted) {
            try {
              await writeEvent({
                dealId: "system",
                kind: "intake.signal_drift_detected",
                actorUserId: null,
                scope: "intake",
                action: "signal_drift_detected",
                confidence: 1.0,
                meta: {
                  drift_type: "llm_fallback_spike",
                  observed: Math.round(delta * 10000) / 10000,
                  threshold: SIGNAL_LLM_FALLBACK_DRIFT_THRESHOLD,
                  window_start: thisWeekStart.toISOString(),
                  window_end: thisWeekEnd.toISOString(),
                  sample_size: thisTotal,
                  detection_version: SIGNAL_DETECTION_VERSION,
                },
              });

              console.log(
                `[detectSignalDrift] LLM fallback spike: ${(delta * 100).toFixed(1)}% increase (n=${thisTotal})`,
              );
            } catch (e) {
              console.warn(
                "[detectSignalDrift] LLM fallback event emit failed (non-fatal):",
                e,
              );
            }
          }
        }
      }
    }

    // ---------------------------------------------------------------------------
    // Check 2: Per-doc-type confidence drop
    // ---------------------------------------------------------------------------

    const [thisTypes, prevTypes] = await Promise.all([
      queryTopDocTypeConfidence(sb, thisWeekStart, thisWeekEnd, SIGNAL_TOP_DOC_TYPES_COUNT),
      queryTopDocTypeConfidence(sb, prevWeekStart, prevWeekEnd, SIGNAL_TOP_DOC_TYPES_COUNT * 2),
    ]);

    if (thisTypes !== null && prevTypes !== null) {
      // Build lookup for prev week by doc type
      const prevByType = new Map<string, DocTypeConfidenceRow>();
      for (const row of prevTypes) {
        prevByType.set(row.effective_doc_type, row);
      }

      for (const thisRow of thisTypes) {
        if (thisRow.doc_count < SIGNAL_MIN_SAMPLE_SIZE) continue;
        if (thisRow.avg_confidence == null) continue;

        const prevRow = prevByType.get(thisRow.effective_doc_type);
        if (!prevRow || prevRow.doc_count < SIGNAL_MIN_SAMPLE_SIZE) continue;
        if (prevRow.avg_confidence == null) continue;

        const drop = prevRow.avg_confidence - thisRow.avg_confidence;

        if (drop > SIGNAL_CONFIDENCE_DROP_THRESHOLD) {
          const alreadyEmitted = await hasDriftEventForType(
            sb,
            "confidence_drop",
            thisRow.effective_doc_type,
          );

          if (!alreadyEmitted) {
            try {
              await writeEvent({
                dealId: "system",
                kind: "intake.signal_drift_detected",
                actorUserId: null,
                scope: "intake",
                action: "signal_drift_detected",
                confidence: 1.0,
                meta: {
                  drift_type: "confidence_drop",
                  doc_type: thisRow.effective_doc_type,
                  observed: Math.round(drop * 10000) / 10000,
                  threshold: SIGNAL_CONFIDENCE_DROP_THRESHOLD,
                  window_start: thisWeekStart.toISOString(),
                  window_end: thisWeekEnd.toISOString(),
                  sample_size: thisRow.doc_count,
                  detection_version: SIGNAL_DETECTION_VERSION,
                },
              });

              console.log(
                `[detectSignalDrift] Confidence drop on ${thisRow.effective_doc_type}: ${(drop * 100).toFixed(1)}% (n=${thisRow.doc_count})`,
              );
            } catch (e) {
              console.warn(
                "[detectSignalDrift] confidence drop event emit failed (non-fatal):",
                e,
              );
            }
          }
        }
      }
    }
  } catch (e) {
    // Fire-and-forget — never propagates
    console.warn("[detectSignalDrift] unexpected error (non-fatal):", e);
  }
}
