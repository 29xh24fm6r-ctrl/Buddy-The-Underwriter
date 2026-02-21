/**
 * Intake + Override Observability v1 — Pure Constants
 *
 * No server-only, no DB, no IO. Safe for CI guard imports.
 */

export const OBSERVABILITY_VERSION = "observability_v1" as const;

export const OBSERVABILITY_VIEWS = [
  "intake_funnel_daily_v1",
  "intake_quality_daily_v1",
  "intake_segmentation_daily_v1",
  "override_intel_daily_v1",
  "override_top_patterns_v1",
] as const;

export const FUNNEL_STAGES = [
  "uploaded",
  "classified",
  "gate_held",
  "confirmed",
  "submitted",
] as const;

export const OVERRIDE_SOURCES = [
  "intake_review_table",
  "cockpit",
] as const;
