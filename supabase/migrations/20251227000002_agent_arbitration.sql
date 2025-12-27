-- =====================================================================
-- SBA God Mode: Agent Arbitration System
-- 
-- Purpose: Resolve conflicts between agent findings through deterministic
--          rules and create a single "Deal Truth" that is traceable,
--          explainable, and overrideable.
-- =====================================================================

-- -----------------------
-- 1) Normalized Claims
--    Atomic assertions from agents (1 finding -> N claims)
-- -----------------------
CREATE TABLE IF NOT EXISTS agent_claims (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    bank_id uuid NOT NULL REFERENCES banks(id),
    
    -- Claim identity (stable hash for conflict detection)
    claim_hash text NOT NULL, -- hash of (topic, predicate, timeframe, unit)
    
    -- Claim content
    topic text NOT NULL, -- 'eligibility' | 'cash_flow' | 'credit' | 'dscr' | etc.
    predicate text NOT NULL, -- e.g., 'is_eligible', 'global_dscr', 'has_tax_lien'
    value_json jsonb NOT NULL,
    unit text, -- e.g., 'dollars', 'ratio', 'percentage'
    timeframe text, -- e.g., '2023', 'TTM', '2022-2024'
    
    -- Provenance
    source_agent text NOT NULL, -- which agent created this claim
    finding_id uuid REFERENCES agent_findings(id) ON DELETE SET NULL,
    evidence_json jsonb, -- links to evidence spans
    sop_citations text[] DEFAULT '{}',
    
    -- Scoring
    confidence numeric(3,2) NOT NULL DEFAULT 0.50 CHECK (confidence >= 0 AND confidence <= 1),
    severity text NOT NULL DEFAULT 'info', -- 'info' | 'warning' | 'blocker'
    
    -- Lifecycle
    created_at timestamptz DEFAULT now(),
    
    -- Indexes
    CONSTRAINT agent_claims_bank_id_check CHECK (bank_id IS NOT NULL)
);

CREATE INDEX idx_agent_claims_deal_id ON agent_claims(deal_id);
CREATE INDEX idx_agent_claims_hash ON agent_claims(deal_id, claim_hash);
CREATE INDEX idx_agent_claims_topic ON agent_claims(topic);
CREATE INDEX idx_agent_claims_severity ON agent_claims(severity);

-- GIN index for JSONB queries
CREATE INDEX idx_agent_claims_value_json ON agent_claims USING gin(value_json);
CREATE INDEX idx_agent_claims_evidence_json ON agent_claims USING gin(evidence_json);

-- RLS
ALTER TABLE agent_claims ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny_all_agent_claims"
ON agent_claims
FOR ALL
USING (false);

COMMENT ON TABLE agent_claims IS 'Normalized atomic claims from agent findings - enables conflict detection';
COMMENT ON COLUMN agent_claims.claim_hash IS 'Stable hash for grouping conflicting claims about same topic';
COMMENT ON COLUMN agent_claims.severity IS 'Impact level: info (FYI), warning (concern), blocker (hard stop)';

-- -----------------------
-- 2) Conflict Sets
--    Groups of claims with same hash but different values
-- -----------------------
CREATE TABLE IF NOT EXISTS claim_conflict_sets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    bank_id uuid NOT NULL REFERENCES banks(id),
    
    -- Conflict identity
    claim_hash text NOT NULL,
    topic text NOT NULL,
    predicate text NOT NULL,
    timeframe text,
    unit text,
    
    -- Conflict metadata
    num_claims int NOT NULL DEFAULT 0,
    num_agents int NOT NULL DEFAULT 0,
    has_blocker boolean NOT NULL DEFAULT false,
    
    -- Resolution status
    status text NOT NULL DEFAULT 'open', -- 'open' | 'resolved' | 'needs_human'
    
    -- Lifecycle
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    
    -- Constraints
    CONSTRAINT claim_conflict_sets_bank_id_check CHECK (bank_id IS NOT NULL)
);

CREATE UNIQUE INDEX idx_conflict_set_unique ON claim_conflict_sets(deal_id, claim_hash);
CREATE INDEX idx_conflict_sets_deal_id ON claim_conflict_sets(deal_id);
CREATE INDEX idx_conflict_sets_status ON claim_conflict_sets(status);

-- RLS
ALTER TABLE claim_conflict_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny_all_claim_conflict_sets"
ON claim_conflict_sets
FOR ALL
USING (false);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_conflict_sets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER claim_conflict_sets_updated_at
    BEFORE UPDATE ON claim_conflict_sets
    FOR EACH ROW
    EXECUTE FUNCTION update_conflict_sets_updated_at();

COMMENT ON TABLE claim_conflict_sets IS 'Groups of conflicting claims requiring arbitration';
COMMENT ON COLUMN claim_conflict_sets.status IS 'open (unresolved), resolved (auto-chosen), needs_human (requires override)';

-- -----------------------
-- 3) Arbitration Decisions
--    Chosen value + rationale for each conflict set
-- -----------------------
CREATE TABLE IF NOT EXISTS arbitration_decisions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    bank_id uuid NOT NULL REFERENCES banks(id),
    
    -- Decision identity
    claim_hash text NOT NULL,
    conflict_set_id uuid REFERENCES claim_conflict_sets(id) ON DELETE CASCADE,
    
    -- Chosen value
    chosen_value_json jsonb,
    chosen_claim_id uuid REFERENCES agent_claims(id) ON DELETE SET NULL,
    
    -- Decision metadata
    decision_status text NOT NULL DEFAULT 'unresolved', -- 'unresolved' | 'chosen' | 'deferred' | 'human_override'
    rationale text,
    
    -- Arbitration trace
    rule_trace_json jsonb, -- which rules fired (R0-R5), weights, scores
    provenance_json jsonb, -- supporting claim IDs and evidence
    dissent_json jsonb, -- non-chosen claims for audit
    
    -- Human oversight
    requires_human_review boolean NOT NULL DEFAULT false,
    created_by text NOT NULL DEFAULT 'system', -- 'system' | 'user_id' | 'bank_overlay'
    override_reason text,
    
    -- Lifecycle
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    
    -- Constraints
    CONSTRAINT arbitration_decisions_bank_id_check CHECK (bank_id IS NOT NULL)
);

CREATE UNIQUE INDEX idx_arbitration_unique ON arbitration_decisions(deal_id, claim_hash);
CREATE INDEX idx_arbitration_deal_id ON arbitration_decisions(deal_id);
CREATE INDEX idx_arbitration_status ON arbitration_decisions(decision_status);
CREATE INDEX idx_arbitration_needs_review ON arbitration_decisions(requires_human_review) WHERE requires_human_review = true;

-- GIN index for JSONB
CREATE INDEX idx_arbitration_rule_trace ON arbitration_decisions USING gin(rule_trace_json);
CREATE INDEX idx_arbitration_provenance ON arbitration_decisions USING gin(provenance_json);

-- RLS
ALTER TABLE arbitration_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny_all_arbitration_decisions"
ON arbitration_decisions
FOR ALL
USING (false);

-- Updated_at trigger
CREATE TRIGGER arbitration_decisions_updated_at
    BEFORE UPDATE ON arbitration_decisions
    FOR EACH ROW
    EXECUTE FUNCTION update_conflict_sets_updated_at();

COMMENT ON TABLE arbitration_decisions IS 'Final arbitrated values for each conflict set with full provenance';
COMMENT ON COLUMN arbitration_decisions.rule_trace_json IS 'Audit trail: which rules fired, weights applied, scores calculated';
COMMENT ON COLUMN arbitration_decisions.provenance_json IS 'Supporting claim IDs that agree with chosen value';
COMMENT ON COLUMN arbitration_decisions.dissent_json IS 'Non-chosen claims preserved for review';

-- -----------------------
-- 4) Deal Truth Snapshots
--    Materialized view of all arbitrated decisions at a point in time
-- -----------------------
CREATE TABLE IF NOT EXISTS deal_truth_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    bank_id uuid NOT NULL REFERENCES banks(id),
    
    -- Truth data
    truth_json jsonb NOT NULL, -- compiled key-value truth from all decisions
    version int NOT NULL,
    
    -- Metadata
    total_claims int NOT NULL DEFAULT 0,
    resolved_claims int NOT NULL DEFAULT 0,
    needs_human int NOT NULL DEFAULT 0,
    overall_confidence numeric(3,2),
    
    -- Bank overlay context
    bank_overlay_id uuid, -- which overlay was applied
    bank_overlay_version int,
    
    -- Lifecycle
    created_at timestamptz DEFAULT now(),
    created_by text NOT NULL DEFAULT 'system',
    
    -- Constraints
    CONSTRAINT deal_truth_snapshots_bank_id_check CHECK (bank_id IS NOT NULL)
);

CREATE INDEX idx_deal_truth_deal_id ON deal_truth_snapshots(deal_id);
CREATE INDEX idx_deal_truth_version ON deal_truth_snapshots(deal_id, version DESC);
CREATE INDEX idx_deal_truth_created_at ON deal_truth_snapshots(created_at DESC);

-- GIN index for truth queries
CREATE INDEX idx_deal_truth_json ON deal_truth_snapshots USING gin(truth_json);

-- RLS
ALTER TABLE deal_truth_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny_all_deal_truth_snapshots"
ON deal_truth_snapshots
FOR ALL
USING (false);

COMMENT ON TABLE deal_truth_snapshots IS 'Versioned snapshots of deal truth - what we believe at this moment';
COMMENT ON COLUMN deal_truth_snapshots.truth_json IS 'Compiled key-value pairs from all arbitrated decisions';
COMMENT ON COLUMN deal_truth_snapshots.version IS 'Monotonically increasing version number';

-- -----------------------
-- 5) Helper Functions
-- -----------------------

-- Generate claim hash (for conflict detection)
CREATE OR REPLACE FUNCTION generate_claim_hash(
    p_topic text,
    p_predicate text,
    p_timeframe text DEFAULT NULL,
    p_unit text DEFAULT NULL
) RETURNS text AS $$
BEGIN
    RETURN encode(
        digest(
            concat_ws('|', p_topic, p_predicate, COALESCE(p_timeframe, ''), COALESCE(p_unit, '')),
            'sha256'
        ),
        'hex'
    );
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION generate_claim_hash IS 'Generates stable hash for grouping conflicting claims';
