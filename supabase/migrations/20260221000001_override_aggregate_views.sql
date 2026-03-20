-- ---------------------------------------------------------------------------
-- Override Aggregate Views — Lightweight Institutional Reads
--
-- Complementary to override_clusters_v1 and override_drift_v1.
-- All ledger-sourced from deal_events only.
-- No duplication of cluster logic.
-- ---------------------------------------------------------------------------

-- Override rate by confirmed doc type (simple count, no min threshold)
CREATE OR REPLACE VIEW override_rate_by_type_v1 AS
SELECT
  payload->'meta'->>'corrected_type' AS doc_type,
  COUNT(*) AS override_count
FROM deal_events
WHERE kind = 'classification.manual_override'
GROUP BY 1
ORDER BY 2 DESC;

-- Override rate by classifier source / anchor tier
CREATE OR REPLACE VIEW override_rate_by_tier_v1 AS
SELECT
  COALESCE(payload->'meta'->>'classifier_source', 'unknown') AS classifier_source,
  COUNT(*) AS override_count
FROM deal_events
WHERE kind = 'classification.manual_override'
GROUP BY 1
ORDER BY 2 DESC;

-- Override rate by confidence band
CREATE OR REPLACE VIEW override_rate_by_confidence_v1 AS
SELECT
  COALESCE(
    payload->'meta'->>'confidence_band',
    CASE
      WHEN (payload->'meta'->>'confidence_at_time')::numeric >= 0.88 THEN 'HIGH'
      WHEN (payload->'meta'->>'confidence_at_time')::numeric >= 0.75 THEN 'MEDIUM'
      ELSE 'LOW'
    END
  ) AS confidence_band,
  COUNT(*) AS override_count
FROM deal_events
WHERE kind = 'classification.manual_override'
  AND payload->'meta'->>'confidence_at_time' IS NOT NULL
  AND payload->'meta'->>'confidence_at_time' ~ '^[0-9.]+$'
GROUP BY 1
ORDER BY 2 DESC;
