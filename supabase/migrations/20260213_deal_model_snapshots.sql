-- Model Engine V2: deal_model_snapshots table
-- Immutable audit trail of V2 model computation results.
-- Written by snapshotService.ts saveModelSnapshot().

CREATE TABLE IF NOT EXISTS deal_model_snapshots (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id               UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  bank_id               UUID NOT NULL,
  model_version         TEXT NOT NULL DEFAULT 'v1',
  metric_registry_hash  TEXT NOT NULL,
  financial_model_hash  TEXT NOT NULL,
  computed_metrics      JSONB NOT NULL DEFAULT '{}',
  risk_flags            JSONB NOT NULL DEFAULT '[]',
  calculated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  triggered_by          TEXT
);

-- Fast lookup: latest snapshot per deal
CREATE INDEX idx_deal_model_snapshots_deal
  ON deal_model_snapshots (deal_id, calculated_at DESC);

-- RLS: service role only
ALTER TABLE deal_model_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role only" ON deal_model_snapshots
  FOR ALL USING (auth.role() = 'service_role');
