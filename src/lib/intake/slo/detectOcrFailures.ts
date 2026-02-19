/**
 * Detect OCR Failures — Governance Monitor
 *
 * Queries intake_ocr_failures_v1. If failed_count_24h > 0 OR
 * empty_ocr_count_24h > 0, emits intake.ocr_failure_detected into
 * deal_events (dealId = "system").
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OcrFailuresRow = {
  failed_count_24h: number | null;
  empty_ocr_count_24h: number | null;
  total_24h: number | null;
  health_color: string | null;
};

// ---------------------------------------------------------------------------
// detectOcrFailures — fire-and-forget, never throws
// ---------------------------------------------------------------------------

/**
 * Scans intake_ocr_failures_v1 for failures or empty OCR results in last 24h.
 * Emits intake.ocr_failure_detected when either metric is non-zero.
 */
export async function detectOcrFailures(): Promise<void> {
  try {
    const sb = supabaseAdmin();

    const { data, error } = await (sb as any)
      .from("intake_ocr_failures_v1")
      .select("*")
      .maybeSingle();

    if (error) {
      console.warn("[detectOcrFailures] query error (non-fatal):", error);
      return;
    }

    if (!data) return;

    const row: OcrFailuresRow = data;
    const failedCount = Number(row.failed_count_24h ?? 0);
    const emptyCount = Number(row.empty_ocr_count_24h ?? 0);

    if (failedCount === 0 && emptyCount === 0) return;

    try {
      await writeEvent({
        dealId: "system",
        kind: "intake.ocr_failure_detected",
        actorUserId: null,
        scope: "intake",
        action: "ocr_failure_detected",
        confidence: 1.0,
        meta: {
          failed_count_24h: failedCount,
          empty_ocr_count_24h: emptyCount,
          total_24h: Number(row.total_24h ?? 0),
          detection_version: DETECTION_VERSION,
        },
      });

      console.log(
        `[detectOcrFailures] OCR failures detected: ${failedCount} failed, ${emptyCount} empty (last 24h)`,
      );
    } catch (e) {
      console.warn("[detectOcrFailures] event emit failed (non-fatal):", e);
    }
  } catch (e) {
    // Fire-and-forget — never propagates
    console.warn("[detectOcrFailures] unexpected error (non-fatal):", e);
  }
}
