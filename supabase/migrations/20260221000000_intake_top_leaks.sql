-- ============================================================================
-- Intake Top Leaks Operating Loop — Layer 1.5
--
-- 5 ranking views derived strictly from Layer 1 base views.
-- Read-only, version-aware, no counters, no mutation.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- VIEW 1: intake_top_slot_overrides_v1
--
-- Slots ranked by override rate (descending).
-- Override data proxied via doc_type join — no per-slot override tracking exists.
-- Minimum threshold: total_attempts > 10
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW intake_top_slot_overrides_v1 AS
SELECT
  s.slot_key,
  s.slot_id,
  s.effective_doc_type,
  s.required_doc_type,
  s.engine_version,
  s.auto_attached,
  s.routed_to_review,
  s.total_attempts,
  s.precision_rate,
  s.friction_rate,
  COALESCE(d.override_count, 0)  AS override_count,
  COALESCE(d.override_rate, 0)   AS override_rate
FROM slot_attachment_metrics_v1 s
LEFT JOIN doc_type_performance_v1 d
  ON  s.effective_doc_type = d.doc_type
  AND (   s.engine_version = d.engine_version
       OR (s.engine_version IS NULL AND d.engine_version IS NULL))
WHERE s.total_attempts > 10
ORDER BY override_rate DESC;


-- ---------------------------------------------------------------------------
-- VIEW 2: intake_top_slot_review_v1
--
-- Slots ranked by review friction rate (descending).
-- friction_rate = routed_to_review / total_attempts.
-- Minimum threshold: total_attempts > 10
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW intake_top_slot_review_v1 AS
SELECT
  slot_key,
  slot_id,
  effective_doc_type,
  required_doc_type,
  engine_version,
  routed_to_review,
  total_attempts,
  friction_rate AS review_rate
FROM slot_attachment_metrics_v1
WHERE total_attempts > 10
ORDER BY friction_rate DESC NULLS LAST;


-- ---------------------------------------------------------------------------
-- VIEW 3: intake_top_doc_type_review_v1
--
-- Doc types ranked by review rate (descending).
-- review_rate = routed_to_review / total_match_events.
-- Minimum threshold: total_match_events > 15
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW intake_top_doc_type_review_v1 AS
SELECT
  doc_type,
  engine_version,
  total_match_events,
  routed_to_review,
  ROUND(
    routed_to_review::numeric /
    NULLIF(total_match_events, 0), 4
  ) AS review_rate
FROM doc_type_performance_v1
WHERE total_match_events > 15
ORDER BY review_rate DESC NULLS LAST;


-- ---------------------------------------------------------------------------
-- VIEW 4: intake_engine_regression_v1
--
-- Engine version regression delta per doc type.
-- Uses LAG() to compare auto_attach_rate across consecutive engine versions.
-- Negative delta = regression. Ordered by delta ASC (worst first).
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW intake_engine_regression_v1 AS
WITH ranked AS (
  SELECT
    doc_type,
    engine_version,
    auto_attach_rate,
    LAG(auto_attach_rate) OVER (
      PARTITION BY doc_type
      ORDER BY engine_version
    ) AS prior_attach_rate
  FROM doc_type_performance_v1
  WHERE engine_version IS NOT NULL
)
SELECT
  doc_type,
  engine_version,
  auto_attach_rate,
  prior_attach_rate,
  ROUND(auto_attach_rate - prior_attach_rate, 4) AS delta
FROM ranked
WHERE prior_attach_rate IS NOT NULL
ORDER BY delta ASC NULLS LAST;


-- ---------------------------------------------------------------------------
-- VIEW 5: intake_confidence_anomalies_v1
--
-- Doc types with HIGH classification confidence but LOW auto-attach rate.
-- These are the most actionable signal: the engine is confident but humans
-- still route to review — indicates slot policy or constraint mismatch.
--
-- Note: classification.decided events store doc_type at payload->'meta'->>'doc_type'
--       and do NOT have engine_version (only schema_version).
--       engine_version is sourced from the join with doc_type_performance_v1.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW intake_confidence_anomalies_v1 AS
WITH classification_confidence AS (
  SELECT
    payload->'meta'->>'doc_type'                         AS doc_type,
    ROUND(AVG((payload->>'confidence')::numeric), 4)     AS avg_confidence,
    COUNT(*)                                              AS sample_count
  FROM deal_events
  WHERE kind = 'classification.decided'
    AND payload->>'confidence' IS NOT NULL
    AND payload->'meta'->>'doc_type' IS NOT NULL
  GROUP BY 1
)
SELECT
  c.doc_type,
  d.engine_version,
  c.avg_confidence,
  c.sample_count,
  d.auto_attach_rate
FROM classification_confidence c
JOIN doc_type_performance_v1 d ON c.doc_type = d.doc_type
WHERE c.avg_confidence > 0.80
  AND d.auto_attach_rate < 0.60
ORDER BY c.avg_confidence DESC;
