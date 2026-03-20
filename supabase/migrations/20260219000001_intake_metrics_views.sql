-- Sprint A: Institutional Operating Layer — Intake Metrics Views
-- Performance index + 3 views for match metrics, global daily, override clusters

-- Performance index
CREATE INDEX IF NOT EXISTS idx_deal_events_kind_created
  ON deal_events(kind, created_at DESC);

-- Per-deal match metrics (version-aware)
CREATE OR REPLACE VIEW v_deal_match_metrics AS
SELECT
  deal_id,
  payload->'meta'->>'engine_version' AS engine_version,
  COUNT(*) FILTER (WHERE kind = 'match.auto_attached') AS auto_attached,
  COUNT(*) FILTER (WHERE kind = 'match.routed_to_review') AS routed_to_review,
  COUNT(*) FILTER (WHERE kind = 'match.no_match') AS no_match,
  COUNT(*) FILTER (WHERE kind LIKE 'match.%') AS total,
  ROUND(
    COUNT(*) FILTER (WHERE kind = 'match.auto_attached')::numeric /
    NULLIF(COUNT(*) FILTER (WHERE kind LIKE 'match.%'), 0), 4
  ) AS auto_attach_rate
FROM deal_events
WHERE kind LIKE 'match.%'
GROUP BY deal_id, engine_version;

-- Global daily metrics (version-aware)
CREATE OR REPLACE VIEW v_intake_global_metrics AS
SELECT
  date_trunc('day', created_at) AS day,
  payload->'meta'->>'engine_version' AS engine_version,
  COUNT(*) FILTER (WHERE kind = 'match.auto_attached') AS auto_attached,
  COUNT(*) FILTER (WHERE kind = 'match.routed_to_review') AS routed_to_review,
  COUNT(*) FILTER (WHERE kind = 'match.no_match') AS no_match,
  COUNT(*) FILTER (WHERE kind LIKE 'match.%') AS total,
  COUNT(*) FILTER (WHERE kind = 'classification.manual_override') AS overrides
FROM deal_events
WHERE kind LIKE 'match.%' OR kind = 'classification.manual_override'
GROUP BY 1, 2
ORDER BY day DESC;

-- Override confusion clusters
CREATE OR REPLACE VIEW v_override_clusters AS
SELECT
  COALESCE(payload->'previous'->>'document_type', payload->>'original_type') AS from_type,
  COALESCE(payload->'new'->>'document_type', payload->'meta'->>'corrected_type') AS to_type,
  COUNT(*) AS override_count,
  MAX(created_at) AS last_seen
FROM deal_events
WHERE kind = 'classification.manual_override'
GROUP BY 1, 2
ORDER BY override_count DESC;
