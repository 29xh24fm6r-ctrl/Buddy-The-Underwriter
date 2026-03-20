-- Deal Participant Events Audit Log
-- Tracks all participant assignments, removals, and changes

CREATE TABLE IF NOT EXISTS deal_participant_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL,
  actor_clerk_user_id TEXT,
  target_clerk_user_id TEXT,
  action TEXT NOT NULL CHECK (action IN (
    'ASSIGN_UNDERWRITER',
    'UNASSIGN_UNDERWRITER',
    'ASSIGN_BORROWER',
    'UNASSIGN_BORROWER',
    'DEACTIVATE_PARTICIPANT',
    'REACTIVATE_PARTICIPANT',
    'BULK_REASSIGN'
  )),
  role TEXT CHECK (role IN ('borrower', 'underwriter', 'bank_admin', 'observer')),
  reason TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for audit queries
CREATE INDEX idx_participant_events_deal ON deal_participant_events(deal_id);
CREATE INDEX idx_participant_events_actor ON deal_participant_events(actor_clerk_user_id);
CREATE INDEX idx_participant_events_target ON deal_participant_events(target_clerk_user_id);
CREATE INDEX idx_participant_events_action ON deal_participant_events(action);
CREATE INDEX idx_participant_events_created ON deal_participant_events(created_at DESC);

-- Comments for documentation
COMMENT ON TABLE deal_participant_events IS 'Audit log for all deal participant assignments and changes';
COMMENT ON COLUMN deal_participant_events.actor_clerk_user_id IS 'User who performed the action (null for system actions)';
COMMENT ON COLUMN deal_participant_events.target_clerk_user_id IS 'User who was assigned/unassigned';
COMMENT ON COLUMN deal_participant_events.action IS 'Type of participant change';
COMMENT ON COLUMN deal_participant_events.reason IS 'Human-readable reason for the change';
COMMENT ON COLUMN deal_participant_events.metadata IS 'Additional context (e.g., bulk reassignment source)';
