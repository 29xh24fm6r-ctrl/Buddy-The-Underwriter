-- ============================================================================
-- Identity Precision Metrics — Layer 2.2
--
-- Measures the effect of entity-assisted precision ranking on match outcomes.
-- Derived from match.* events with entity_confidence metadata.
-- Read-only, version-aware, no mutation.
-- ============================================================================

CREATE OR REPLACE VIEW identity_precision_effect_v1 AS
SELECT
  payload->'meta'->>'effective_doc_type'            AS doc_type,
  payload->'meta'->>'engine_version'                AS engine_version,
  COUNT(*) FILTER (
    WHERE (payload->'meta'->>'entity_confidence')::numeric >= 0.85
  )                                                  AS high_confidence_events,
  COUNT(*) FILTER (
    WHERE kind = 'match.auto_attached'
      AND (payload->'meta'->>'entity_confidence')::numeric >= 0.85
  )                                                  AS precision_auto_attached
FROM deal_events
WHERE kind LIKE 'match.%'
GROUP BY 1, 2
ORDER BY high_confidence_events DESC;
