-- SBA God Mode: Deal Truth Events Table
-- Migration: 20251227000004_deal_truth_events.sql
--
-- Event log for deal truth changes.
-- Used to trigger downstream consumers (narrative agent, evidence agent, borrower tasks).

CREATE TABLE IF NOT EXISTS deal_truth_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
  
  event_type text NOT NULL CHECK (event_type IN ('deal.truth.updated', 'deal.truth.conflict_resolved')),
  truth_snapshot_id uuid NOT NULL REFERENCES deal_truth_snapshots(id) ON DELETE CASCADE,
  
  trigger text NOT NULL CHECK (trigger IN ('agent_run', 'manual_override', 'bank_overlay', 'periodic_refresh')),
  changed_topics text[] NOT NULL DEFAULT '{}',
  
  metadata jsonb DEFAULT '{}',
  
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Indexes for querying
CREATE INDEX idx_deal_truth_events_deal_id ON deal_truth_events(deal_id);
CREATE INDEX idx_deal_truth_events_bank_id ON deal_truth_events(bank_id);
CREATE INDEX idx_deal_truth_events_created_at ON deal_truth_events(created_at DESC);
CREATE INDEX idx_deal_truth_events_event_type ON deal_truth_events(event_type);

-- RLS Policies
ALTER TABLE deal_truth_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Banks can view their own events"
  ON deal_truth_events
  FOR SELECT
  USING (bank_id = current_setting('app.current_bank_id')::uuid);

CREATE POLICY "Service role full access"
  ON deal_truth_events
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Comments
COMMENT ON TABLE deal_truth_events IS 'Event log for deal truth changes, used to trigger downstream consumers';
COMMENT ON COLUMN deal_truth_events.trigger IS 'What caused this truth update: agent run, manual override, bank overlay, or periodic refresh';
COMMENT ON COLUMN deal_truth_events.changed_topics IS 'List of topics that changed in this update (e.g., ["eligibility", "cash_flow"])';
