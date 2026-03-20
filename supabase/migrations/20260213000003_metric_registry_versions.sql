-- Phase 12: Metric Registry Versioning (Audit Mode)
--
-- Two new tables for versioned, immutable metric registry.
-- Snapshots bind to a specific registry version + content hash.

-- =========================================================================
-- 1) metric_registry_versions — immutable published snapshots of the registry
-- =========================================================================

CREATE TABLE IF NOT EXISTS metric_registry_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version_name    TEXT NOT NULL,
  version_number  INT NOT NULL DEFAULT 1,
  content_hash    TEXT,
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'published', 'deprecated')),
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID
);

COMMENT ON TABLE metric_registry_versions IS 'Immutable published snapshots of the metric registry. Phase 12.';
COMMENT ON COLUMN metric_registry_versions.content_hash IS 'SHA-256 of canonical JSON of all entries. Set on publish.';
COMMENT ON COLUMN metric_registry_versions.status IS 'draft → published → deprecated. Entries immutable once published.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_mrv_version_name
  ON metric_registry_versions (version_name);

-- RLS: service role only
ALTER TABLE metric_registry_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only" ON metric_registry_versions
  FOR ALL USING (auth.role() = 'service_role');

-- =========================================================================
-- 2) metric_registry_entries — per-metric definitions within a version
-- =========================================================================

CREATE TABLE IF NOT EXISTS metric_registry_entries (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registry_version_id   UUID NOT NULL REFERENCES metric_registry_versions(id) ON DELETE CASCADE,
  metric_key            TEXT NOT NULL,
  definition_json       JSONB NOT NULL,
  definition_hash       TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(registry_version_id, metric_key)
);

COMMENT ON TABLE metric_registry_entries IS 'Per-metric definitions within a registry version. Immutable once version is published.';
COMMENT ON COLUMN metric_registry_entries.definition_json IS 'Canonical metric definition (label, expr, precision, requiredFacts, etc).';
COMMENT ON COLUMN metric_registry_entries.definition_hash IS 'SHA-256 of canonical JSON of this single entry.';

CREATE INDEX IF NOT EXISTS idx_mre_version_id
  ON metric_registry_entries (registry_version_id);

-- RLS: service role only
ALTER TABLE metric_registry_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only" ON metric_registry_entries
  FOR ALL USING (auth.role() = 'service_role');

-- =========================================================================
-- 3) Extend deal_model_snapshots with registry version binding
-- =========================================================================

ALTER TABLE deal_model_snapshots
  ADD COLUMN IF NOT EXISTS registry_version_id   UUID REFERENCES metric_registry_versions(id),
  ADD COLUMN IF NOT EXISTS registry_content_hash TEXT,
  ADD COLUMN IF NOT EXISTS registry_version_name TEXT,
  ADD COLUMN IF NOT EXISTS engine_version        TEXT,
  ADD COLUMN IF NOT EXISTS compute_trace_id      TEXT,
  ADD COLUMN IF NOT EXISTS outputs_hash          TEXT;

COMMENT ON COLUMN deal_model_snapshots.registry_version_id IS 'FK to metric_registry_versions. Binds snapshot to exact registry.';
COMMENT ON COLUMN deal_model_snapshots.registry_content_hash IS 'SHA-256 content hash of registry at compute time. For replay verification.';
COMMENT ON COLUMN deal_model_snapshots.outputs_hash IS 'SHA-256 of canonical outputs. For replay determinism proof.';
