-- ============================================================================
-- Entity Constraint Enforcement Metrics — v1.4.0
--
-- Tracks the behavioral shift from E3.3 soft-skip (v1.3.1) to
-- E4 hard enforcement (v1.4.0). Measures:
--   1. Entity constraint hard-fail events (entity=null → no_match)
--   2. Identity ambiguity rejections
--   3. Engine version adoption curve
--
-- Derived from match.* events. Read-only, version-aware, no mutation.
-- ============================================================================

CREATE OR REPLACE VIEW entity_constraint_enforcement_v1 AS
SELECT
  payload->'meta'->>'engine_version'                   AS engine_version,
  kind                                                  AS match_outcome,
  COUNT(*)                                              AS total_events,
  COUNT(*) FILTER (
    WHERE payload->'meta'->>'entity_id' IS NULL
      AND payload->'meta'->>'slot_entity_required' = 'true'
  )                                                     AS entity_null_hard_fail,
  COUNT(*) FILTER (
    WHERE payload->'meta'->>'entity_ambiguous' = 'true'
  )                                                     AS ambiguity_rejected,
  COUNT(*) FILTER (
    WHERE kind = 'match.auto_attached'
      AND payload->'meta'->>'entity_id' IS NOT NULL
  )                                                     AS entity_bound_auto_attached,
  DATE_TRUNC('day', created_at)                         AS event_day
FROM deal_events
WHERE kind LIKE 'match.%'
GROUP BY 1, 2, 7
ORDER BY event_day DESC, engine_version DESC;
