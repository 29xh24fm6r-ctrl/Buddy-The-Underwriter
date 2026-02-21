"use client";

import {
  CONFIDENCE_THRESHOLDS,
  type ConfidenceBand,
} from "@/lib/classification/calibrateConfidence";

// ---------------------------------------------------------------------------
// Band derivation (mirrors deriveBand from calibrateConfidence.ts,
// using the same exported thresholds — no duplicated constants)
// ---------------------------------------------------------------------------

function resolveBand(confidence: number | null | undefined): ConfidenceBand {
  if (confidence != null && confidence >= CONFIDENCE_THRESHOLDS.HIGH) return "HIGH";
  if (confidence != null && confidence >= CONFIDENCE_THRESHOLDS.MEDIUM) return "MEDIUM";
  return "LOW";
}

// ---------------------------------------------------------------------------
// Color model (no red — confidence is not failure)
// ---------------------------------------------------------------------------

const BAND_STYLES: Record<ConfidenceBand, string> = {
  HIGH: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  MEDIUM: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  LOW: "bg-slate-500/20 text-slate-400 border-slate-500/30",
};

const CONFIRMED_STYLE = "bg-blue-500/20 text-blue-400 border-blue-500/30";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type ConfidenceBadgeProps = {
  /** Raw confidence value (0–1). Used to derive band if band not provided. */
  confidence?: number | null;
  /** Explicit band (from rawExtraction.calibration.band). Takes priority. */
  band?: ConfidenceBand;
  /** When true, shows "CONFIRMED" badge (human-verified classification). */
  confirmed?: boolean;
};

/**
 * Institutional confidence badge for classification confidence.
 *
 * Displays HIGH / MEDIUM / LOW band label with color coding.
 * When confirmed=true, displays CONFIRMED in neutral blue (human-verified).
 * No red — confidence is probabilistic, not a failure indicator.
 *
 * Resolution order:
 *   1. confirmed=true → CONFIRMED badge (neutral blue)
 *   2. Explicit band prop (from rawExtraction when available)
 *   3. Derived from confidence using shared CONFIDENCE_THRESHOLDS
 */
export function ConfidenceBadge({ confidence, band, confirmed }: ConfidenceBadgeProps) {
  if (confirmed) {
    return (
      <span
        className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium border ${CONFIRMED_STYLE}`}
        title="Classification confirmed by banker"
      >
        CONFIRMED
      </span>
    );
  }

  const resolved = band ?? resolveBand(confidence);

  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium border ${BAND_STYLES[resolved]}`}
      title={confidence != null ? `${(confidence * 100).toFixed(0)}% confidence` : undefined}
    >
      {resolved}
    </span>
  );
}
