/**
 * Compute Intake Health Score — Pure Function
 *
 * Deterministic 0–100 score from 6 boolean intake signals.
 * Used by:
 *   - Lifecycle blocker emission (when ENABLE_INTAKE_SLO_ENFORCEMENT=true)
 *   - Governance dashboard (always rendered)
 *
 * NON-NEGOTIABLE:
 *   - No DB, no IO, no side effects
 *   - No import of classifyDocument, matchEngine, or any classification/matching logic
 *   - Same input → same output (deterministic)
 *   - No stacking identical-category deductions
 *   - Minimum score = 0, maximum score = 100
 *   - HEALTH_SCORE_VERSION must be exported for audit trail stability
 */

// ---------------------------------------------------------------------------
// Version constant — exported for CI guard verification and audit trail
// ---------------------------------------------------------------------------

export const HEALTH_SCORE_VERSION = "health_v1";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IntakeHealthInput = {
  /** True if gatekeeper flagged hard-review documents (not just LOW_CONFIDENCE) */
  hasReviewRequired: boolean;
  /** True if a manual classification override occurred for this deal */
  hasManualOverride: boolean;
  /** True if a document.segmentation_failed event exists for this deal */
  hasSegmentationFailed: boolean;
  /** True if any queue job_type has health_color = 'red' (backlog detected) */
  queueBacklogActive: boolean;
  /** True if intake.classification_slo_violation was emitted in the last 24h */
  classificationSloViolation: boolean;
  /** True if any worker has health_color = 'red' (worker unhealthy) */
  workerUnhealthy: boolean;
};

export type IntakeHealthDeduction = {
  reason: string;
  points: number;
};

export type IntakeHealthResult = {
  /** 0–100. Higher is healthier. */
  score: number;
  /** Per-category deduction audit trail — no duplicate reasons */
  deductions: IntakeHealthDeduction[];
  /** Versioned for audit trail stability */
  scoring_version: typeof HEALTH_SCORE_VERSION;
};

// ---------------------------------------------------------------------------
// Deduction table — per-category, applied once (no stacking)
// ---------------------------------------------------------------------------

const DEDUCTIONS: Record<string, number> = {
  review_required:       20,
  manual_override:       20,
  segmentation_failed:   30,
  queue_backlog:         30,
  classification_slo:    30,
  worker_unhealthy:      20,
} as const;

// ---------------------------------------------------------------------------
// computeIntakeHealthScore — pure function
// ---------------------------------------------------------------------------

/**
 * Computes intake health score from 6 boolean signals.
 *
 * Deducts once per category — never twice for the same category.
 * Score is clamped to [0, 100].
 */
export function computeIntakeHealthScore(
  input: IntakeHealthInput,
): IntakeHealthResult {
  const deductions: IntakeHealthDeduction[] = [];

  if (input.hasReviewRequired) {
    deductions.push({ reason: "review_required", points: DEDUCTIONS.review_required });
  }
  if (input.hasManualOverride) {
    deductions.push({ reason: "manual_override", points: DEDUCTIONS.manual_override });
  }
  if (input.hasSegmentationFailed) {
    deductions.push({ reason: "segmentation_failed", points: DEDUCTIONS.segmentation_failed });
  }
  if (input.queueBacklogActive) {
    deductions.push({ reason: "queue_backlog", points: DEDUCTIONS.queue_backlog });
  }
  if (input.classificationSloViolation) {
    deductions.push({ reason: "classification_slo", points: DEDUCTIONS.classification_slo });
  }
  if (input.workerUnhealthy) {
    deductions.push({ reason: "worker_unhealthy", points: DEDUCTIONS.worker_unhealthy });
  }

  const totalDeducted = deductions.reduce((sum, d) => sum + d.points, 0);
  const score = Math.max(0, 100 - totalDeducted);

  return {
    score,
    deductions,
    scoring_version: HEALTH_SCORE_VERSION,
  };
}
