-- ============================================================================
-- Identity Enforcement Metrics — Layer 2.1
--
-- Derived strictly from match.identity_mismatch events.
-- Read-only, version-aware, no mutation.
-- ============================================================================

CREATE OR REPLACE VIEW identity_enforcement_events_v1 AS
SELECT
  payload->'meta'->>'effective_doc_type'  AS doc_type,
  payload->'meta'->>'engine_version'       AS engine_version,
  COUNT(*)                                  AS enforcement_count
FROM deal_events
WHERE kind = 'match.identity_mismatch'
GROUP BY 1, 2
ORDER BY enforcement_count DESC;
