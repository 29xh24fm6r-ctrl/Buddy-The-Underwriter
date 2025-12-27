-- SBA God Mode: Agent Findings Table
-- This table stores outputs from all AI agents in the SBA underwriting swarm

CREATE TABLE IF NOT EXISTS agent_findings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    bank_id uuid NOT NULL REFERENCES banks(id),
    
    -- Agent identification
    agent_name text NOT NULL, -- 'sba_policy' | 'eligibility' | 'credit' | 'cash_flow' | 'collateral' | 'management' | 'risk' | 'narrative' | 'evidence' | 'banker_copilot'
    agent_version text NOT NULL DEFAULT 'v1',
    
    -- Finding metadata
    finding_type text NOT NULL, -- 'requirement' | 'risk' | 'recommendation' | 'narrative' | 'evidence' | 'question'
    status text NOT NULL, -- 'pass' | 'fail' | 'conditional' | 'pending' | 'override'
    confidence numeric(3,2) CHECK (confidence >= 0 AND confidence <= 1), -- 0.00 to 1.00
    
    -- Core data
    input_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    output_json jsonb NOT NULL DEFAULT '{}'::jsonb,
    evidence_json jsonb DEFAULT '{}'::jsonb,
    
    -- Human oversight
    requires_human_review boolean DEFAULT false,
    human_override boolean DEFAULT false,
    override_reason text,
    override_by uuid REFERENCES auth.users(id),
    override_at timestamptz,
    
    -- Lifecycle
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    expires_at timestamptz, -- For findings that become stale
    
    -- Indexes
    CONSTRAINT agent_findings_bank_id_check CHECK (bank_id IS NOT NULL)
);

-- Indexes for performance
CREATE INDEX idx_agent_findings_deal_id ON agent_findings(deal_id);
CREATE INDEX idx_agent_findings_bank_id ON agent_findings(bank_id);
CREATE INDEX idx_agent_findings_agent_name ON agent_findings(agent_name);
CREATE INDEX idx_agent_findings_status ON agent_findings(status);
CREATE INDEX idx_agent_findings_requires_review ON agent_findings(requires_human_review) WHERE requires_human_review = true;
CREATE INDEX idx_agent_findings_created_at ON agent_findings(created_at DESC);

-- GIN index for JSONB queries
CREATE INDEX idx_agent_findings_output_json ON agent_findings USING gin(output_json);
CREATE INDEX idx_agent_findings_evidence_json ON agent_findings USING gin(evidence_json);

-- RLS: Deny all by default (use supabaseAdmin with tenant checks)
ALTER TABLE agent_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny_all_agent_findings"
ON agent_findings
FOR ALL
USING (false);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_agent_findings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER agent_findings_updated_at
    BEFORE UPDATE ON agent_findings
    FOR EACH ROW
    EXECUTE FUNCTION update_agent_findings_updated_at();

-- Comments
COMMENT ON TABLE agent_findings IS 'AI agent outputs for SBA underwriting swarm - each agent writes findings here';
COMMENT ON COLUMN agent_findings.agent_name IS 'Which agent generated this finding';
COMMENT ON COLUMN agent_findings.confidence IS 'AI confidence score 0.00-1.00';
COMMENT ON COLUMN agent_findings.requires_human_review IS 'Flag for underwriter review';
COMMENT ON COLUMN agent_findings.human_override IS 'Did a human override the AI decision?';
