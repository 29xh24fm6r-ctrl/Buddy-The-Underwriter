-- ============================================================================
-- Intake + Override Observability v1 — 5 read-only views
-- ============================================================================
--
-- All views derive from deal_events or deal_documents (canonical sources).
-- All use CREATE OR REPLACE — safe to re-run.
-- None replace any existing view.
-- No schema mutations.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- V1: intake_funnel_daily_v1
--
-- Daily intake funnel counts from deal_events.
-- Stages: uploaded → classified → gate_held → confirmed → submitted
-- Timing: median seconds between upload→classified and classified→confirmed
-- per deal (approximation via MIN per deal).
-- 60-day rolling window.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW intake_funnel_daily_v1 AS
WITH daily_events AS (
  SELECT
    created_at::date AS day,
    kind,
    deal_id,
    created_at
  FROM deal_events
  WHERE kind IN (
    'upload.received',
    'classification.decided',
    'intake.gate_held',
    'intake.document_confirmed',
    'intake.document_corrected',
    'intake.confirmed_processing_complete'
  )
  AND created_at >= NOW() - INTERVAL '60 days'
),
daily_counts AS (
  SELECT
    day,
    COUNT(*) FILTER (WHERE kind = 'upload.received')                          AS uploaded,
    COUNT(*) FILTER (WHERE kind = 'classification.decided')                   AS classified,
    COUNT(*) FILTER (WHERE kind = 'intake.gate_held')                         AS gate_held,
    COUNT(*) FILTER (WHERE kind IN (
      'intake.document_confirmed', 'intake.document_corrected'
    ))                                                                         AS confirmed,
    COUNT(*) FILTER (WHERE kind = 'intake.confirmed_processing_complete')     AS submitted
  FROM daily_events
  GROUP BY day
),
deal_timing AS (
  SELECT
    deal_id,
    MIN(created_at) FILTER (WHERE kind = 'upload.received')                   AS first_upload,
    MIN(created_at) FILTER (WHERE kind = 'classification.decided')            AS first_classified,
    MIN(created_at) FILTER (WHERE kind IN (
      'intake.document_confirmed', 'intake.document_corrected'
    ))                                                                         AS first_confirmed
  FROM daily_events
  GROUP BY deal_id
),
daily_timing AS (
  SELECT
    first_upload::date AS day,
    PERCENTILE_CONT(0.5) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (first_classified - first_upload))
    ) FILTER (
      WHERE first_classified IS NOT NULL AND first_upload IS NOT NULL
    )                                                                          AS median_upload_to_classify_s,
    PERCENTILE_CONT(0.5) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (first_confirmed - first_classified))
    ) FILTER (
      WHERE first_confirmed IS NOT NULL AND first_classified IS NOT NULL
    )                                                                          AS median_classify_to_confirm_s
  FROM deal_timing
  WHERE first_upload IS NOT NULL
  GROUP BY first_upload::date
)
SELECT
  c.day,
  c.uploaded,
  c.classified,
  c.gate_held,
  c.confirmed,
  c.submitted,
  ROUND(t.median_upload_to_classify_s::numeric, 1)                            AS median_upload_to_classify_s,
  ROUND(t.median_classify_to_confirm_s::numeric, 1)                           AS median_classify_to_confirm_s
FROM daily_counts c
LEFT JOIN daily_timing t ON c.day = t.day
ORDER BY c.day DESC;

-- ---------------------------------------------------------------------------
-- V2: intake_quality_daily_v1
--
-- Daily quality gate pass/fail from deal_documents.quality_status.
-- Grouped by created_at::date. Rolling 60-day window.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW intake_quality_daily_v1 AS
SELECT
  created_at::date                                                             AS day,
  COUNT(*)                                                                     AS total_docs,
  COUNT(*) FILTER (WHERE quality_status = 'PASSED')                           AS passed,
  COUNT(*) FILTER (WHERE quality_status = 'FAILED_LOW_TEXT')                  AS failed_low_text,
  COUNT(*) FILTER (WHERE quality_status = 'FAILED_LOW_CONFIDENCE')            AS failed_low_confidence,
  COUNT(*) FILTER (WHERE quality_status = 'FAILED_OCR_ERROR')                 AS failed_ocr_error,
  COUNT(*) FILTER (WHERE quality_status IS NULL)                              AS not_evaluated,
  ROUND(
    COUNT(*) FILTER (WHERE quality_status = 'PASSED')::numeric
    / NULLIF(COUNT(*), 0),
    4
  )                                                                            AS pass_rate
FROM deal_documents
WHERE created_at >= NOW() - INTERVAL '60 days'
GROUP BY created_at::date
ORDER BY day DESC;

-- ---------------------------------------------------------------------------
-- V3: intake_segmentation_daily_v1
--
-- Daily segmentation detection and split metrics from deal_events.
-- 60-day rolling window.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW intake_segmentation_daily_v1 AS
SELECT
  created_at::date                                                             AS day,
  COUNT(*)                                                                     AS detected,
  COUNT(*) FILTER (
    WHERE (payload->'meta'->>'physically_split')::boolean IS TRUE
  )                                                                            AS physically_split,
  COUNT(*) FILTER (
    WHERE COALESCE((payload->'meta'->>'physically_split')::boolean, FALSE) IS NOT TRUE
  )                                                                            AS detected_not_split,
  COALESCE(SUM(
    CASE
      WHEN payload->'meta'->>'child_count' ~ '^\d+$'
      THEN (payload->'meta'->>'child_count')::int
      ELSE 0
    END
  ), 0)                                                                        AS total_children_created,
  ROUND(AVG(
    CASE
      WHEN payload->'meta'->>'segment_count' ~ '^\d+$'
      THEN (payload->'meta'->>'segment_count')::numeric
      ELSE NULL
    END
  ), 1)                                                                        AS avg_segments_per_doc
FROM deal_events
WHERE kind = 'segmentation.detected'
  AND created_at >= NOW() - INTERVAL '60 days'
GROUP BY created_at::date
ORDER BY day DESC;

-- ---------------------------------------------------------------------------
-- V4: override_intel_daily_v1
--
-- Daily manual override counts from deal_events, split by source dimension.
-- Source = payload.meta.source ('intake_review_table' | 'cockpit' | null).
-- 60-day rolling window.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW override_intel_daily_v1 AS
SELECT
  created_at::date                                                             AS day,
  COALESCE(payload->'meta'->>'source', 'unknown')                            AS override_source,
  COUNT(*)                                                                     AS override_count,
  ROUND(AVG(
    CASE
      WHEN payload->'meta'->>'confidence_at_time' IS NOT NULL
        AND payload->'meta'->>'confidence_at_time' ~ '^[0-9.]+$'
      THEN (payload->'meta'->>'confidence_at_time')::numeric
      ELSE NULL
    END
  ), 3)                                                                        AS avg_confidence_at_time,
  MODE() WITHIN GROUP (
    ORDER BY COALESCE(payload->'meta'->>'classifier_source', 'unknown')
  )                                                                            AS dominant_classifier_source
FROM deal_events
WHERE kind = 'classification.manual_override'
  AND created_at >= NOW() - INTERVAL '60 days'
GROUP BY created_at::date, COALESCE(payload->'meta'->>'source', 'unknown')
ORDER BY day DESC;

-- ---------------------------------------------------------------------------
-- V5: override_top_patterns_v1
--
-- 30-day rollup of top override patterns (from → to) with source breakdown.
-- Intentionally separate from override_clusters_v1 (which uses HAVING ≥ 3,
-- no time window, and no source dimension).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW override_top_patterns_v1 AS
SELECT
  payload->'meta'->>'original_type'                                           AS from_type,
  payload->'meta'->>'corrected_type'                                          AS to_type,
  COALESCE(payload->'meta'->>'source', 'unknown')                            AS override_source,
  COUNT(*)                                                                     AS pattern_count,
  ROUND(AVG(
    CASE
      WHEN payload->'meta'->>'confidence_at_time' IS NOT NULL
        AND payload->'meta'->>'confidence_at_time' ~ '^[0-9.]+$'
      THEN (payload->'meta'->>'confidence_at_time')::numeric
      ELSE NULL
    END
  ), 3)                                                                        AS avg_confidence,
  COALESCE(
    MODE() WITHIN GROUP (
      ORDER BY payload->'meta'->>'classifier_source'
    ),
    'unknown'
  )                                                                            AS dominant_classifier,
  MIN(created_at)                                                              AS first_seen,
  MAX(created_at)                                                              AS last_seen
FROM deal_events
WHERE kind = 'classification.manual_override'
  AND payload->'meta'->>'original_type' IS NOT NULL
  AND payload->'meta'->>'corrected_type' IS NOT NULL
  AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY 1, 2, 3
ORDER BY pattern_count DESC;
