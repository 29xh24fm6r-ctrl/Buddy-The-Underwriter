-- ---------------------------------------------------------------------------
-- Phase B: Override Intelligence — Cluster & Drift Views
--
-- Both views are ledger-sourced from deal_events only.
-- Never derived from deal_documents or current classification state.
-- Ledger is source of truth.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- override_clusters_v1
--
-- High-signal correction patterns (≥3 occurrences).
-- Groups by (original_type → corrected_type), includes:
--   - avg_confidence_at_time: how confident was the classifier before the human corrected it
--   - dominant_classifier_source: which classifier produced the most errors in this cluster
--   - dominant_confidence_bucket: low/medium/high bucket mode for the cluster
--   - classification_version_range: min→max version that produced this error
--   - segmentation_presence_ratio: fraction of overrides that occurred on segmented docs
--     (if this spikes on segmented docs, segmentation needs tuning — not classification)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW override_clusters_v1 AS
SELECT
  payload->'meta'->>'original_type'                                       AS from_type,
  payload->'meta'->>'corrected_type'                                      AS to_type,
  COUNT(*)                                                                AS override_count,
  ROUND(AVG(
    CASE
      WHEN payload->'meta'->>'confidence_at_time' IS NOT NULL
        AND payload->'meta'->>'confidence_at_time' ~ '^[0-9.]+$'
      THEN (payload->'meta'->>'confidence_at_time')::numeric
      ELSE NULL
    END
  ), 3)                                                                   AS avg_confidence_at_time,
  MODE() WITHIN GROUP (
    ORDER BY COALESCE(payload->'meta'->>'classifier_source', 'unknown')
  )                                                                       AS dominant_classifier_source,
  MODE() WITHIN GROUP (
    ORDER BY
      CASE
        WHEN payload->'meta'->>'confidence_at_time' IS NULL
          OR NOT (payload->'meta'->>'confidence_at_time' ~ '^[0-9.]+$')
          THEN 'low'
        WHEN (payload->'meta'->>'confidence_at_time')::numeric < 0.70
          THEN 'low'
        WHEN (payload->'meta'->>'confidence_at_time')::numeric < 0.90
          THEN 'medium'
        ELSE 'high'
      END
  )                                                                       AS dominant_confidence_bucket,
  COALESCE(MIN(payload->'meta'->>'classification_version'), 'unknown')
    || ' → '
    || COALESCE(MAX(payload->'meta'->>'classification_version'), 'unknown')
                                                                          AS classification_version_range,
  ROUND(
    COUNT(*) FILTER (
      WHERE payload->'meta'->>'segmentation_version' IS NOT NULL
    )::numeric / GREATEST(COUNT(*), 1)::numeric,
    3
  )                                                                       AS segmentation_presence_ratio,
  MIN(created_at)                                                         AS first_seen_at,
  MAX(created_at)                                                         AS last_seen_at
FROM deal_events
WHERE kind = 'classification.manual_override'
  AND payload->'meta'->>'original_type' IS NOT NULL
  AND payload->'meta'->>'corrected_type' IS NOT NULL
GROUP BY 1, 2
HAVING COUNT(*) >= 3
ORDER BY override_count DESC;

-- ---------------------------------------------------------------------------
-- override_drift_v1
--
-- 7-day WoW delta — detects regression spikes.
-- When delta ≥ +3 week-over-week, detectOverrideDrift() emits
-- intake.override_drift_detected ledger alert.
-- Includes classifier_source and classification_version for root-cause diagnosis.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW override_drift_v1 AS
WITH weekly AS (
  SELECT
    DATE_TRUNC('week', created_at)                           AS week_start,
    payload->'meta'->>'original_type'                        AS from_type,
    payload->'meta'->>'corrected_type'                       AS to_type,
    COALESCE(payload->'meta'->>'classifier_source', 'unknown') AS classifier_source,
    COALESCE(payload->'meta'->>'classification_version', 'unknown') AS classification_version,
    COUNT(*)                                                 AS weekly_count
  FROM deal_events
  WHERE kind = 'classification.manual_override'
  GROUP BY 1, 2, 3, 4, 5
)
SELECT
  week_start,
  from_type,
  to_type,
  classifier_source,
  classification_version,
  weekly_count,
  LAG(weekly_count) OVER (
    PARTITION BY from_type, to_type ORDER BY week_start
  )                                                          AS prev_week_count,
  weekly_count
    - COALESCE(LAG(weekly_count) OVER (
        PARTITION BY from_type, to_type ORDER BY week_start
      ), 0)                                                  AS delta
FROM weekly
ORDER BY week_start DESC, delta DESC;
