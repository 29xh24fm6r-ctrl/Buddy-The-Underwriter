/**
 * Detect Classification SLO — Governance Monitor
 *
 * Queries deal_documents to compute P95 and P99 classification latency
 * (finalized_at - created_at) over the last 7 days, excluding MANUAL tier.
 *
 * SLO Targets:
 *   P95 < 30s
 *   P99 < 90s
 *
 * If either breaches AND sample_size >= 20, emits
 * intake.classification_slo_violation into deal_events (dealId = "system").
 *
 * Called from: observer tick / ops cron
 * Fire-and-forget: never throws, always swallows errors.
 *
 * Every emitted event includes detection_version for audit trail stability.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DETECTION_VERSION = "detect_v1";
const SLO_P95_THRESHOLD_SECONDS = 30;
const SLO_P99_THRESHOLD_SECONDS = 90;
const MIN_SAMPLE_SIZE = 20;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Compute percentile from a pre-sorted ascending array of numbers.
 * Returns the value at the given percentile (0–100).
 */
function computePercentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, Math.min(idx, sortedValues.length - 1))];
}

// ---------------------------------------------------------------------------
// detectClassificationSlo — fire-and-forget, never throws
// ---------------------------------------------------------------------------

/**
 * Scans deal_documents (last 7 days, non-MANUAL, finalized) for SLO breaches.
 * Requires sample_size >= 20 to avoid false positives from low-traffic periods.
 */
export async function detectClassificationSlo(): Promise<void> {
  try {
    const sb = supabaseAdmin();

    // Query last 7 days of finalized non-MANUAL documents
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await (sb as any)
      .from("deal_documents")
      .select("created_at, finalized_at")
      .not("finalized_at", "is", null)
      .gte("created_at", sevenDaysAgo)
      .neq("classification_tier", "MANUAL");

    if (error) {
      console.warn("[detectClassificationSlo] query error (non-fatal):", error);
      return;
    }

    if (!data || data.length === 0) return;

    // Compute classification latency in seconds for each document
    const latencies: number[] = [];
    for (const row of data) {
      if (!row.created_at || !row.finalized_at) continue;
      const created = new Date(row.created_at).getTime();
      const finalized = new Date(row.finalized_at).getTime();
      const seconds = (finalized - created) / 1000;
      // Only include non-negative latencies (negative = clock skew or data issue)
      if (seconds >= 0) {
        latencies.push(seconds);
      }
    }

    const sampleSize = latencies.length;
    if (sampleSize < MIN_SAMPLE_SIZE) {
      // Insufficient sample — skip to avoid false positives
      return;
    }

    // Sort ascending for percentile computation
    latencies.sort((a, b) => a - b);

    const p95 = computePercentile(latencies, 95);
    const p99 = computePercentile(latencies, 99);

    // Emit one event per breached percentile
    if (p95 > SLO_P95_THRESHOLD_SECONDS) {
      try {
        await writeEvent({
          dealId: "system",
          kind: "intake.classification_slo_violation",
          actorUserId: null,
          scope: "intake",
          action: "classification_slo_violation",
          confidence: 1.0,
          meta: {
            percentile: 95,
            threshold_seconds: SLO_P95_THRESHOLD_SECONDS,
            observed_seconds: Math.round(p95),
            sample_size: sampleSize,
            detection_version: DETECTION_VERSION,
          },
        });

        console.log(
          `[detectClassificationSlo] P95 SLO breach: ${Math.round(p95)}s > ${SLO_P95_THRESHOLD_SECONDS}s (n=${sampleSize})`,
        );
      } catch (e) {
        console.warn("[detectClassificationSlo] P95 event emit failed (non-fatal):", e);
      }
    }

    if (p99 > SLO_P99_THRESHOLD_SECONDS) {
      try {
        await writeEvent({
          dealId: "system",
          kind: "intake.classification_slo_violation",
          actorUserId: null,
          scope: "intake",
          action: "classification_slo_violation",
          confidence: 1.0,
          meta: {
            percentile: 99,
            threshold_seconds: SLO_P99_THRESHOLD_SECONDS,
            observed_seconds: Math.round(p99),
            sample_size: sampleSize,
            detection_version: DETECTION_VERSION,
          },
        });

        console.log(
          `[detectClassificationSlo] P99 SLO breach: ${Math.round(p99)}s > ${SLO_P99_THRESHOLD_SECONDS}s (n=${sampleSize})`,
        );
      } catch (e) {
        console.warn("[detectClassificationSlo] P99 event emit failed (non-fatal):", e);
      }
    }
  } catch (e) {
    // Fire-and-forget — never propagates
    console.warn("[detectClassificationSlo] unexpected error (non-fatal):", e);
  }
}
