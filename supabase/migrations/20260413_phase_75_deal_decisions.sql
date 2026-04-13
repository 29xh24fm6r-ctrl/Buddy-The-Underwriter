-- Phase 75 Step 1: deal_decisions table
--
-- Fixes P0 bug: approve/decline/escalate wrote invalid stage values
-- ("approved", "declined", "committee") to deals.stage which are NOT
-- valid LifecycleStage values, silently breaking the deal.
--
-- Decision outcomes now live in deal_decisions (append-only audit table)
-- instead of corrupting deals.stage.

CREATE TABLE IF NOT EXISTS deal_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  bank_id UUID NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'declined', 'tabled', 'conditional_approval', 'escalate')),
  decided_by TEXT NOT NULL,           -- Clerk user ID
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reconciliation_status TEXT,         -- snapshot of recon status at decision time
  evidence JSONB NOT NULL DEFAULT '{}',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_decisions_deal ON deal_decisions(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_decisions_decision ON deal_decisions(decision);
CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_decisions_active
  ON deal_decisions(deal_id)
  WHERE decision IN ('approve', 'approve_with_conditions');

ALTER TABLE deal_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all"
  ON deal_decisions FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "authenticated_read"
  ON deal_decisions FOR SELECT
  USING (auth.role() = 'authenticated');

COMMENT ON TABLE deal_decisions IS
  'Immutable audit log of approve/decline/escalate decisions. Replaces invalid deals.stage writes. Phase 75 P0 fix.';
