-- ============================================================================
-- Atomic Observability Views — Layer 1
--
-- Slot-level precision, doc-type-level performance, confidence distribution.
-- All views derive from deal_events. All GROUP BY engine_version.
-- Measurement only — no authority tables, no denormalized counters.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- VIEW 1: slot_attachment_metrics_v1
--
-- Per-slot precision and friction from match.* events.
-- required_doc_type will be NULL for historical events until payload enrichment.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW slot_attachment_metrics_v1 AS
SELECT
  COALESCE(payload->'meta'->>'slot_key', 'unmatched') AS slot_key,
  payload->'meta'->>'slot_id' AS slot_id,
  payload->'meta'->>'engine_version' AS engine_version,
  payload->'meta'->>'effective_doc_type' AS effective_doc_type,
  payload->'meta'->>'required_doc_type' AS required_doc_type,

  COUNT(*) FILTER (WHERE kind = 'match.auto_attached') AS auto_attached,
  COUNT(*) FILTER (WHERE kind = 'match.routed_to_review') AS routed_to_review,
  COUNT(*) FILTER (WHERE kind = 'match.no_match') AS no_match,
  COUNT(*) AS total_attempts,

  ROUND(
    COUNT(*) FILTER (WHERE kind = 'match.auto_attached')::numeric /
    NULLIF(COUNT(*), 0), 4
  ) AS precision_rate,

  ROUND(
    COUNT(*) FILTER (WHERE kind = 'match.routed_to_review')::numeric /
    NULLIF(COUNT(*), 0), 4
  ) AS friction_rate

FROM deal_events
WHERE kind LIKE 'match.%'
GROUP BY 1, 2, 3, 4, 5;


-- ---------------------------------------------------------------------------
-- VIEW 2: doc_type_performance_v1
--
-- Per-doc-type auto-attach/review/override rates.
-- Joins match.* events with classification.manual_override events.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW doc_type_performance_v1 AS
WITH
  matches AS (
    SELECT
      payload->'meta'->>'effective_doc_type' AS doc_type,
      payload->'meta'->>'engine_version' AS engine_version,
      COUNT(*) FILTER (WHERE kind = 'match.auto_attached') AS auto_attached,
      COUNT(*) FILTER (WHERE kind = 'match.routed_to_review') AS routed_to_review,
      COUNT(*) FILTER (WHERE kind = 'match.no_match') AS no_match,
      COUNT(*) AS total_match_events
    FROM deal_events
    WHERE kind LIKE 'match.%'
    GROUP BY 1, 2
  ),
  overrides AS (
    SELECT
      COALESCE(
        payload->'meta'->>'original_type',
        payload->'previous'->>'document_type'
      ) AS doc_type,
      COUNT(*) AS override_count
    FROM deal_events
    WHERE kind = 'classification.manual_override'
    GROUP BY 1
  )
SELECT
  COALESCE(m.doc_type, o.doc_type) AS doc_type,
  m.engine_version,
  COALESCE(m.auto_attached, 0) AS auto_attached,
  COALESCE(m.routed_to_review, 0) AS routed_to_review,
  COALESCE(m.no_match, 0) AS no_match,
  COALESCE(m.total_match_events, 0) AS total_match_events,
  COALESCE(o.override_count, 0) AS override_count,
  ROUND(
    COALESCE(m.auto_attached, 0)::numeric /
    NULLIF(COALESCE(m.total_match_events, 0), 0), 4
  ) AS auto_attach_rate,
  ROUND(
    COALESCE(o.override_count, 0)::numeric /
    NULLIF(COALESCE(m.total_match_events, 0), 0), 4
  ) AS override_rate
FROM matches m
FULL OUTER JOIN overrides o ON m.doc_type = o.doc_type;


-- ---------------------------------------------------------------------------
-- VIEW 3: confidence_distribution_v1
--
-- Confidence bucket histogram from classification.decided events.
-- Grouped by classification_tier and schema_version for version-aware audit.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW confidence_distribution_v1 AS
SELECT
  CASE
    WHEN (payload->>'confidence')::numeric >= 0.95 THEN '0.95-1.00'
    WHEN (payload->>'confidence')::numeric >= 0.90 THEN '0.90-0.95'
    WHEN (payload->>'confidence')::numeric >= 0.85 THEN '0.85-0.90'
    WHEN (payload->>'confidence')::numeric >= 0.80 THEN '0.80-0.85'
    WHEN (payload->>'confidence')::numeric >= 0.70 THEN '0.70-0.80'
    WHEN (payload->>'confidence')::numeric >= 0.50 THEN '0.50-0.70'
    ELSE '0.00-0.50'
  END AS confidence_bucket,
  payload->'evidence'->>'tier' AS classification_tier,
  payload->'meta'->>'schema_version' AS schema_version,
  COUNT(*) AS event_count
FROM deal_events
WHERE kind = 'classification.decided'
  AND payload->>'confidence' IS NOT NULL
GROUP BY 1, 2, 3
ORDER BY confidence_bucket DESC;
