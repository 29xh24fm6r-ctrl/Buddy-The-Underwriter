-- Deal Participants Table for Role-Based Deal Access
-- Replaces borrower_clerk_user_id column approach with normalized participant model

CREATE TABLE IF NOT EXISTS deal_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  clerk_user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('borrower', 'underwriter', 'bank_admin')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}',
  
  -- Unique constraint: one user can have one role per deal
  UNIQUE(deal_id, clerk_user_id, role)
);

-- Indexes for fast lookups
CREATE INDEX idx_deal_participants_deal ON deal_participants(deal_id);
CREATE INDEX idx_deal_participants_user ON deal_participants(clerk_user_id);
CREATE INDEX idx_deal_participants_role ON deal_participants(role);
CREATE INDEX idx_deal_participants_active ON deal_participants(is_active) WHERE is_active = true;
CREATE INDEX idx_deal_participants_updated ON deal_participants(updated_at DESC);

-- Comments for documentation
COMMENT ON TABLE deal_participants IS 'Role-based participants in loan deals (borrowers, underwriters, bank admins)';
COMMENT ON COLUMN deal_participants.role IS 'User role for this deal: borrower, underwriter, or bank_admin';
COMMENT ON COLUMN deal_participants.is_active IS 'Whether this participant assignment is currently active';
COMMENT ON COLUMN deal_participants.updated_at IS 'Last activity timestamp for this participant on this deal';
