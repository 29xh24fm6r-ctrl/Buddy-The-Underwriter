-- =====================================================================
-- CONNECT ACCOUNTS SCHEMA
-- Borrower-connected data sources for auto-population
-- =====================================================================

-- Account connection types
CREATE TYPE account_connection_type AS ENUM (
  'plaid_bank',
  'quickbooks_online',
  'quickbooks_desktop',
  'xero',
  'gusto',
  'adp',
  'paychex',
  'irs_transcript',
  'state_tax_transcript',
  'id_verification',
  'ofac_check'
);

-- Connection status
CREATE TYPE connection_status AS ENUM (
  'pending',
  'active',
  'expired',
  'revoked',
  'error'
);

-- ---------------------------------------------------------------------
-- borrower_account_connections
-- Tracks all connected accounts per deal
-- ---------------------------------------------------------------------
CREATE TABLE borrower_account_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id UUID NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  connection_type account_connection_type NOT NULL,
  status connection_status NOT NULL DEFAULT 'pending',
  
  -- Provider-specific metadata
  provider_id TEXT, -- Plaid item_id, QBO company_id, etc.
  provider_metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Credentials (encrypted at rest in production)
  access_token TEXT,
  refresh_token TEXT,
  expires_at TIMESTAMPTZ,
  
  -- Data freshness
  last_sync_at TIMESTAMPTZ,
  last_sync_status TEXT,
  next_sync_at TIMESTAMPTZ,
  
  -- Audit
  connected_by UUID REFERENCES auth.users(id),
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disconnected_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_borrower_connections_deal ON borrower_account_connections(deal_id);
CREATE INDEX idx_borrower_connections_bank ON borrower_account_connections(bank_id);
CREATE INDEX idx_borrower_connections_type ON borrower_account_connections(connection_type);
CREATE INDEX idx_borrower_connections_status ON borrower_account_connections(status, next_sync_at);

-- RLS: Deny-all (access via service role with tenant checks)
ALTER TABLE borrower_account_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all_borrower_account_connections ON borrower_account_connections FOR ALL USING (false);


-- ---------------------------------------------------------------------
-- connected_account_data
-- Normalized data extracted from connected accounts
-- ---------------------------------------------------------------------
CREATE TABLE connected_account_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id UUID NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES borrower_account_connections(id) ON DELETE CASCADE,
  
  -- Data classification
  data_type TEXT NOT NULL, -- 'bank_transaction', 'financial_statement', 'tax_return', 'payroll_record'
  data_category TEXT, -- 'cash_flow', 'balance_sheet', 'p_and_l', 'tax_verification'
  
  -- Normalized data
  normalized_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  raw_data JSONB, -- Original API response
  
  -- Evidence linking
  evidence_field_path TEXT, -- Which deal truth field this populates
  evidence_confidence DECIMAL(5,4), -- AI confidence score
  
  -- Time range covered
  period_start DATE,
  period_end DATE,
  
  -- Audit
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_connected_data_deal ON connected_account_data(deal_id);
CREATE INDEX idx_connected_data_connection ON connected_account_data(connection_id);
CREATE INDEX idx_connected_data_type ON connected_account_data(data_type, data_category);
CREATE INDEX idx_connected_data_evidence ON connected_account_data(evidence_field_path);
CREATE INDEX idx_connected_data_period ON connected_account_data(period_start, period_end);

-- GIN index for JSONB queries
CREATE INDEX idx_connected_data_normalized ON connected_account_data USING gin(normalized_data);

-- RLS: Deny-all
ALTER TABLE connected_account_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all_connected_account_data ON connected_account_data FOR ALL USING (false);


-- ---------------------------------------------------------------------
-- document_substitutions
-- Tracks which docs were auto-satisfied by connected accounts
-- ---------------------------------------------------------------------
CREATE TABLE document_substitutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id UUID NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  connection_id UUID NOT NULL REFERENCES borrower_account_connections(id) ON DELETE CASCADE,
  
  -- Substitution details
  original_doc_requirement TEXT NOT NULL, -- 'Bank Statements', 'Tax Returns', etc.
  substituted_by account_connection_type NOT NULL,
  substitution_conditions JSONB, -- Conditions that were met
  
  -- Impact
  readiness_boost DECIMAL(5,2), -- How much this boosted readiness %
  docs_saved INTEGER, -- Number of upload requirements eliminated
  
  -- Approval
  auto_approved BOOLEAN DEFAULT true,
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_doc_substitutions_deal ON document_substitutions(deal_id);
CREATE INDEX idx_doc_substitutions_connection ON document_substitutions(connection_id);

-- RLS: Deny-all
ALTER TABLE document_substitutions ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_all_document_substitutions ON document_substitutions FOR ALL USING (false);


-- ---------------------------------------------------------------------
-- Helper: Get active connections for a deal
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_active_connections(p_deal_id UUID)
RETURNS TABLE (
  connection_type account_connection_type,
  provider_id TEXT,
  last_sync_at TIMESTAMPTZ,
  data_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    c.connection_type,
    c.provider_id,
    c.last_sync_at,
    COUNT(d.id) as data_count
  FROM borrower_account_connections c
  LEFT JOIN connected_account_data d ON d.connection_id = c.id
  WHERE c.deal_id = p_deal_id
    AND c.status = 'active'
  GROUP BY c.connection_type, c.provider_id, c.last_sync_at
  ORDER BY c.connected_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ---------------------------------------------------------------------
-- Helper: Calculate readiness boost from connections
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION calculate_connection_boost(p_deal_id UUID)
RETURNS DECIMAL(5,2) AS $$
DECLARE
  v_boost DECIMAL(5,2) := 0;
  v_has_plaid BOOLEAN;
  v_has_accounting BOOLEAN;
  v_has_irs BOOLEAN;
BEGIN
  -- Check connection types
  SELECT 
    bool_or(connection_type = 'plaid_bank') as has_plaid,
    bool_or(connection_type IN ('quickbooks_online', 'quickbooks_desktop', 'xero')) as has_accounting,
    bool_or(connection_type = 'irs_transcript') as has_irs
  INTO v_has_plaid, v_has_accounting, v_has_irs
  FROM borrower_account_connections
  WHERE deal_id = p_deal_id
    AND status = 'active';
  
  -- Apply boosts
  IF v_has_plaid THEN v_boost := v_boost + 15; END IF;
  IF v_has_accounting THEN v_boost := v_boost + 20; END IF;
  IF v_has_irs THEN v_boost := v_boost + 25; END IF;
  
  RETURN v_boost;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


COMMENT ON TABLE borrower_account_connections IS 'Connected accounts (Plaid, QuickBooks, IRS, etc.) for auto-population';
COMMENT ON TABLE connected_account_data IS 'Normalized data extracted from connected accounts';
COMMENT ON TABLE document_substitutions IS 'Document requirements auto-satisfied by connected accounts';
