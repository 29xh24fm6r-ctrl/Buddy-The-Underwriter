-- Cross-Document Reconciliation results table

CREATE TABLE IF NOT EXISTS deal_reconciliation_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL,
  checks_run INTEGER NOT NULL DEFAULT 0,
  checks_passed INTEGER NOT NULL DEFAULT 0,
  checks_failed INTEGER NOT NULL DEFAULT 0,
  checks_skipped INTEGER NOT NULL DEFAULT 0,
  hard_failures JSONB NOT NULL DEFAULT '[]',
  soft_flags JSONB NOT NULL DEFAULT '[]',
  overall_status TEXT NOT NULL CHECK (overall_status IN ('CLEAN','FLAGS','CONFLICTS')),
  reconciled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reconciliation_deal_id
  ON deal_reconciliation_results(deal_id);

CREATE INDEX IF NOT EXISTS idx_reconciliation_status
  ON deal_reconciliation_results(overall_status);

ALTER TABLE deal_reconciliation_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all"
  ON deal_reconciliation_results FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "authenticated_read"
  ON deal_reconciliation_results FOR SELECT
  USING (auth.role() = 'authenticated');
