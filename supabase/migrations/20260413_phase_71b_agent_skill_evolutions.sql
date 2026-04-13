-- Phase 71B: Agent skill evolution staging table
-- Pending evolutions from analyst corrections, awaiting human approval
-- before any prompt template is modified.

CREATE TABLE IF NOT EXISTS agent_skill_evolutions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id     TEXT NOT NULL,
  fact_key     TEXT NOT NULL,
  document_type TEXT NOT NULL,
  source       TEXT NOT NULL CHECK (source IN ('analyst_correction', 'pattern_threshold')),
  context      TEXT NOT NULL,
  proposed_change JSONB NOT NULL,
  applied      BOOLEAN NOT NULL DEFAULT FALSE,
  approved_by  TEXT,
  approved_at  TIMESTAMPTZ,
  rejected     BOOLEAN NOT NULL DEFAULT FALSE,
  rejected_by  TEXT,
  rejected_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_skill_evolutions_agent ON agent_skill_evolutions(agent_id);
CREATE INDEX idx_agent_skill_evolutions_applied ON agent_skill_evolutions(applied);
CREATE INDEX idx_agent_skill_evolutions_pending
  ON agent_skill_evolutions(agent_id)
  WHERE applied = FALSE AND rejected = FALSE;

ALTER TABLE agent_skill_evolutions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON agent_skill_evolutions
  FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE agent_skill_evolutions IS
  'Pending skill evolutions from analyst corrections. Human approval required before prompt changes. Phase 71B.';
