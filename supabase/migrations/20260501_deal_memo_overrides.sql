-- Phase 52: deal_memo_overrides table for Story panel memo field overrides
CREATE TABLE IF NOT EXISTS deal_memo_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  bank_id UUID NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
  overrides JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (deal_id, bank_id)
);

-- RLS
ALTER TABLE deal_memo_overrides ENABLE ROW LEVEL SECURITY;

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_deal_memo_overrides_deal_bank ON deal_memo_overrides(deal_id, bank_id);
