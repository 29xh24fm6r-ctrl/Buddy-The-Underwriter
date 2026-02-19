-- ============================================================================
-- Phase D — Intake Signal Intelligence Views
-- ============================================================================
--
-- Four read-only views that instrument intake signal quality.
-- All use existing deal_documents columns — no schema changes.
-- All use CREATE OR REPLACE — safe to apply in any environment.
--
-- Note: deal_documents uses canonical_type (not effective_doc_type).
--       Views expose it AS effective_doc_type for API/TypeScript consistency.
--
-- Views:
--   intake_signal_strength_v1         — confidence distribution per doc type
--   intake_classifier_source_mix_v1   — per-type source dependency curves
--   intake_segmentation_impact_v1     — segmentation ROI (SEGMENT vs ROOT)
--   intake_override_signal_correlation_v1 — override rate + confidence variance
--
-- D4 (entity binding coverage) reuses existing slot_entity_binding_coverage_v1
-- ============================================================================

-- ---------------------------------------------------------------------------
-- D1: intake_signal_strength_v1
-- Per-doc-type confidence distribution, 30-day rolling window.
-- Health color excludes manual docs from assessment (manual = human choice,
-- not classifier weakness).
-- Health color is advisory — not lifecycle gating.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW intake_signal_strength_v1 AS
SELECT
  canonical_type                                                    AS effective_doc_type,
  COUNT(*)                                                          AS total_docs,
  ROUND(AVG(classification_confidence)::numeric, 4)                AS avg_confidence,
  ROUND(MIN(classification_confidence)::numeric, 4)                AS min_confidence,
  ROUND(MAX(classification_confidence)::numeric, 4)                AS max_confidence,
  ROUND(STDDEV(classification_confidence)::numeric, 4)             AS confidence_stddev,
  COUNT(*) FILTER (WHERE classification_confidence < 0.70)         AS low_confidence_count,
  CASE
    WHEN AVG(classification_confidence)
         FILTER (WHERE match_source != 'manual') >= 0.85 THEN 'green'
    WHEN AVG(classification_confidence)
         FILTER (WHERE match_source != 'manual') >= 0.70 THEN 'amber'
    ELSE 'red'
  END                                                               AS health_color
FROM deal_documents
WHERE
  finalized_at IS NOT NULL
  AND created_at >= NOW() - INTERVAL '30 days'
  AND classification_confidence IS NOT NULL
GROUP BY canonical_type
ORDER BY total_docs DESC;

-- ---------------------------------------------------------------------------
-- D2: intake_classifier_source_mix_v1
-- Source dependency curves PARTITIONED BY canonical_type.
-- Per-type curves reveal hidden LLM dependency.
-- A doc type going 40% LLM is signal. Globally 40% is noise.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW intake_classifier_source_mix_v1 AS
SELECT
  canonical_type                                                    AS effective_doc_type,
  match_source,
  COUNT(*)                                                          AS doc_count,
  ROUND(
    COUNT(*)::numeric
    / NULLIF(SUM(COUNT(*)) OVER (PARTITION BY canonical_type), 0),
    4
  )                                                                 AS fraction_within_type,
  ROUND(AVG(classification_confidence)::numeric, 4)                AS avg_confidence
FROM deal_documents
WHERE
  finalized_at IS NOT NULL
  AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY canonical_type, match_source
ORDER BY canonical_type, doc_count DESC;

-- ---------------------------------------------------------------------------
-- D3: intake_segmentation_impact_v1
-- Real structural segmentation: parent_document_id IS NOT NULL = SEGMENT.
-- NOT a lateral join on events — that tests event existence, not document
-- structure. Measures true segmentation ROI across confidence, speed, overrides.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW intake_segmentation_impact_v1 AS
SELECT
  CASE
    WHEN parent_document_id IS NOT NULL THEN 'SEGMENT'
    ELSE 'ROOT'
  END                                                               AS document_class,
  COUNT(*)                                                          AS doc_count,
  ROUND(AVG(classification_confidence)::numeric, 4)                AS avg_confidence,
  ROUND(
    AVG(EXTRACT(EPOCH FROM (finalized_at - created_at)))::numeric,
    1
  )                                                                 AS avg_classification_seconds,
  ROUND(
    COUNT(*) FILTER (WHERE match_source = 'manual')::numeric
    / NULLIF(COUNT(*), 0),
    4
  )                                                                 AS manual_override_rate
FROM deal_documents
WHERE
  finalized_at IS NOT NULL
  AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY document_class;

-- ---------------------------------------------------------------------------
-- D5: intake_override_signal_correlation_v1
-- Correlates manual override rate with confidence + variance per doc type.
-- stddev is early warning: variance widens before override spikes appear.
-- recent_manual_count (7-day window) captures in-progress degradation
-- before it shows in the 30-day aggregate.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW intake_override_signal_correlation_v1 AS
SELECT
  canonical_type                                                    AS effective_doc_type,
  COUNT(*)                                                          AS total_docs,
  COUNT(*) FILTER (WHERE match_source = 'manual')                  AS manual_override_count,
  COUNT(*) FILTER (
    WHERE match_source = 'manual'
      AND created_at >= NOW() - INTERVAL '7 days'
  )                                                                 AS recent_manual_count,
  ROUND(
    COUNT(*) FILTER (WHERE match_source = 'manual')::numeric
    / NULLIF(COUNT(*), 0),
    4
  )                                                                 AS manual_override_rate,
  ROUND(AVG(classification_confidence)::numeric, 4)                AS avg_confidence,
  ROUND(STDDEV(classification_confidence)::numeric, 4)             AS confidence_stddev,
  CASE
    WHEN COUNT(*) FILTER (WHERE match_source = 'manual')::numeric
         / NULLIF(COUNT(*), 0) > 0.25 THEN 'red'
    WHEN COUNT(*) FILTER (WHERE match_source = 'manual')::numeric
         / NULLIF(COUNT(*), 0) > 0.10 THEN 'amber'
    ELSE 'green'
  END                                                               AS health_color
FROM deal_documents
WHERE
  finalized_at IS NOT NULL
  AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY canonical_type
ORDER BY manual_override_rate DESC NULLS LAST;
