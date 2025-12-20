-- =====================================================================
-- POLICY DEFAULTS MIGRATION
-- Auto-fill bank forms with policy-compliant defaults
-- =====================================================================

-- bank_policy_defaults: Stores extracted default values from policy chunks
CREATE TABLE bank_policy_defaults (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  bank_id UUID NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
  
  -- Scoping: Which deal types/industries does this default apply to?
  deal_type TEXT,          -- 'sba_7a', 'sba_504', 'conventional', 'equipment', etc.
  industry TEXT,           -- 'restaurant', 'retail', 'manufacturing', etc.
  
  -- Field identification
  field_name TEXT NOT NULL,     -- 'interest_rate', 'guarantee_fee', 'term_months', etc.
  field_label TEXT NOT NULL,    -- Human-readable: "Interest Rate", "Guarantee Fee"
  field_type TEXT NOT NULL,     -- 'number', 'text', 'select', 'percentage', 'currency'
  
  -- Default value
  default_value TEXT NOT NULL,  -- JSON-encoded: "7.5", "Prime + 2.75", "120", etc.
  
  -- Evidence & metadata
  chunk_id UUID REFERENCES bank_policy_chunks(id) ON DELETE SET NULL,
  confidence_score DECIMAL(3,2) DEFAULT 1.0, -- 0.0-1.0 (how confident are we?)
  source_text TEXT,                          -- Snippet from chunk that supports this default
  
  -- Constraints (optional)
  min_value DECIMAL,
  max_value DECIMAL,
  allowed_values JSONB,  -- For select fields: ["Prime + 2.75", "Prime + 3.00"]
  
  -- Audit
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT,
  
  -- Unique constraint: one default per (bank, deal_type, industry, field_name)
  CONSTRAINT unique_default UNIQUE (bank_id, deal_type, industry, field_name)
);

-- Indexes
CREATE INDEX idx_policy_defaults_bank ON bank_policy_defaults(bank_id);
CREATE INDEX idx_policy_defaults_scope ON bank_policy_defaults(bank_id, deal_type, industry);
CREATE INDEX idx_policy_defaults_field ON bank_policy_defaults(field_name);

-- RLS policies
ALTER TABLE bank_policy_defaults ENABLE ROW LEVEL SECURITY;

-- Read: Members of the bank can read defaults
CREATE POLICY "Bank members can read policy defaults"
  ON bank_policy_defaults FOR SELECT
  USING (
    bank_id IN (
      SELECT bank_id FROM bank_memberships WHERE user_id = auth.uid()
    )
  );

-- Write: Only service_role (API) can insert/update/delete
CREATE POLICY "Service role can manage policy defaults"
  ON bank_policy_defaults FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- =====================================================================
-- deal_policy_deviations: Track when users override policy defaults
-- =====================================================================

CREATE TABLE deal_policy_deviations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  
  -- Which field was overridden?
  field_name TEXT NOT NULL,
  field_label TEXT NOT NULL,
  
  -- What was the default vs what was entered?
  policy_default TEXT NOT NULL,  -- What the policy said
  actual_value TEXT NOT NULL,    -- What the user entered
  
  -- Why did they override?
  justification TEXT,            -- User's explanation
  
  -- Audit
  created_at TIMESTAMPTZ DEFAULT now(),
  created_by TEXT
);

-- Indexes
CREATE INDEX idx_deal_deviations_deal ON deal_policy_deviations(deal_id);
CREATE INDEX idx_deal_deviations_field ON deal_policy_deviations(field_name);

-- RLS policies
ALTER TABLE deal_policy_deviations ENABLE ROW LEVEL SECURITY;

-- Read: Members of the bank can read deviations for their deals
CREATE POLICY "Bank members can read deal deviations"
  ON deal_policy_deviations FOR SELECT
  USING (
    deal_id IN (
      SELECT d.id FROM deals d
      JOIN bank_memberships bm ON d.bank_id = bm.bank_id
      WHERE bm.user_id = auth.uid()
    )
  );

-- Write: Members can insert deviations for their bank's deals
CREATE POLICY "Bank members can create deal deviations"
  ON deal_policy_deviations FOR INSERT
  WITH CHECK (
    deal_id IN (
      SELECT d.id FROM deals d
      JOIN bank_memberships bm ON d.bank_id = bm.bank_id
      WHERE bm.user_id = auth.uid()
    )
  );

-- Service role can do anything
CREATE POLICY "Service role can manage deal deviations"
  ON deal_policy_deviations FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- =====================================================================
-- COMMENTS
-- =====================================================================

COMMENT ON TABLE bank_policy_defaults IS 'Policy-compliant default values for bank forms, extracted from policy chunks';
COMMENT ON TABLE deal_policy_deviations IS 'Tracks when users override policy defaults with custom values';

COMMENT ON COLUMN bank_policy_defaults.deal_type IS 'Scope: Which deal types does this default apply to? NULL = all types';
COMMENT ON COLUMN bank_policy_defaults.industry IS 'Scope: Which industries? NULL = all industries';
COMMENT ON COLUMN bank_policy_defaults.field_name IS 'Machine name: interest_rate, guarantee_fee, term_months';
COMMENT ON COLUMN bank_policy_defaults.field_label IS 'Human-readable label shown in UI';
COMMENT ON COLUMN bank_policy_defaults.default_value IS 'JSON-encoded default value';
COMMENT ON COLUMN bank_policy_defaults.confidence_score IS 'AI confidence (0.0-1.0). Lower = needs human review';
COMMENT ON COLUMN bank_policy_defaults.source_text IS 'Snippet from policy chunk supporting this default';
