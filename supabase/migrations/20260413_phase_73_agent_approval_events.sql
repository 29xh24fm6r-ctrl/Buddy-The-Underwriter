-- Phase 73C: Immutable approval event log (SR 11-7 compliance)
--
-- No outbound borrower communication is permitted without a corresponding
-- agent_approval_events record where decision = 'approved'.
--
-- This table is append-only. Rows MUST NOT be updated or deleted.

CREATE TABLE IF NOT EXISTS agent_approval_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What entity is being approved
  entity_type TEXT NOT NULL,           -- 'draft_borrower_request', 'borrower_campaign', etc.
  entity_id UUID NOT NULL,             -- FK to the entity being approved

  -- Decision
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'revoked')),
  decided_by TEXT NOT NULL,            -- Clerk user ID
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Exact content at time of decision
  snapshot_json JSONB NOT NULL,

  -- Optional context
  reason TEXT,                         -- Rejection/revocation reason

  -- Audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_approval_events_entity
  ON agent_approval_events(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_approval_events_decided_by
  ON agent_approval_events(decided_by);

CREATE INDEX IF NOT EXISTS idx_approval_events_decided_at
  ON agent_approval_events(decided_at DESC);

-- RLS
ALTER TABLE agent_approval_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all"
  ON agent_approval_events FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "authenticated_read"
  ON agent_approval_events FOR SELECT
  USING (auth.role() = 'authenticated');

COMMENT ON TABLE agent_approval_events IS
  'Immutable audit log of approval/rejection decisions for agent-generated content. SR 11-7 compliance. Append-only.';
