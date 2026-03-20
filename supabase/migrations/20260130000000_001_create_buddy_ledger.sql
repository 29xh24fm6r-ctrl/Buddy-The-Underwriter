-- Canonical ledger table (single source of truth)
CREATE TABLE IF NOT EXISTS buddy_ledger_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identifiers
  deal_id UUID NULL,
  bank_id UUID NULL,
  actor_user_id TEXT NULL,
  actor_role TEXT NULL,

  -- Classification
  source TEXT NOT NULL DEFAULT 'buddy',
  event_type TEXT NOT NULL,
  event_category TEXT NOT NULL DEFAULT 'system',
  severity TEXT NOT NULL DEFAULT 'info',

  -- Event payload (must be sanitized server-side)
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Correlation
  trace_id TEXT NULL,
  session_id TEXT NULL,
  page_url TEXT NULL,

  -- Mismatch detection
  expected_outcome JSONB NULL,
  actual_outcome JSONB NULL,
  is_mismatch BOOLEAN NOT NULL DEFAULT FALSE,

  -- Metadata
  env TEXT NOT NULL DEFAULT 'production',
  release TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT valid_severity CHECK (severity IN ('debug','info','warning','error','critical')),
  CONSTRAINT valid_category CHECK (event_category IN ('system','ui','flow','error','signal'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ble_created_at ON buddy_ledger_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ble_deal_id ON buddy_ledger_events(deal_id) WHERE deal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ble_type ON buddy_ledger_events(event_type);
CREATE INDEX IF NOT EXISTS idx_ble_category ON buddy_ledger_events(event_category);
CREATE INDEX IF NOT EXISTS idx_ble_severity ON buddy_ledger_events(severity);
CREATE INDEX IF NOT EXISTS idx_ble_mismatch ON buddy_ledger_events(is_mismatch) WHERE is_mismatch = TRUE;
CREATE INDEX IF NOT EXISTS idx_ble_trace_id ON buddy_ledger_events(trace_id) WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ble_source ON buddy_ledger_events(source);
CREATE INDEX IF NOT EXISTS idx_ble_env ON buddy_ledger_events(env);

-- RLS: default DENY. Only server/service-role writes/reads.
ALTER TABLE buddy_ledger_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='buddy_ledger_events' AND policyname='service_role_all'
  ) THEN
    CREATE POLICY service_role_all ON buddy_ledger_events
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

COMMENT ON TABLE buddy_ledger_events IS 'Canonical immutable observability ledger. Written by Buddy server and Pulse server only.';
