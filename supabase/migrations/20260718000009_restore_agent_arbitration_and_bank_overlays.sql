-- Restores the entire "agent arbitration" writer subsystem that feeds
-- deal_truth_snapshots (already restored in 20260718000008), which in turn
-- feeds etran/generator.ts's generateETranXML.
--
-- Root cause: same untracked-migration pattern documented in
-- 20260718000008 — agent_claims, claim_conflict_sets, arbitration_decisions
-- (all from 20251227000002_agent_arbitration.sql) and bank_overlays,
-- overlay_application_log, overlay_generated_claims (all from
-- 20251227000003_bank_overlays.sql), plus their helper functions
-- generate_claim_hash() and update_conflict_sets_updated_at(), do not
-- exist in this database at all — confirmed via to_regclass/pg_proc —
-- even though both migrations are recorded as applied in
-- supabase_migrations.schema_migrations. They were dropped by something
-- never checked into this repo, most likely alongside the same cleanup
-- that stubbed deal_truth_snapshots (an RLS-hardening pass is recorded
-- immediately before the stub migration in the migration history).
--
-- Every real consumer of these tables already exists and is correctly
-- written against this exact schema:
--   POST /arbitration/ingest      -> writes agent_claims, claim_conflict_sets
--   POST /arbitration/reconcile   -> reads claim_conflict_sets/agent_claims,
--                                    optionally reads bank_overlays, writes
--                                    arbitration_decisions +
--                                    overlay_application_log
--   POST /arbitration/materialize -> reads arbitration_decisions, writes
--                                    deal_truth_snapshots
--   GET  /arbitration/status      -> reads all of the above
-- This migration restores the schema those routes were always written
-- against; it does not change any application code (see the accompanying
-- punchlist.ts fix for a separate, real bug in a different consumer that
-- this restoration makes reachable for the first time).
--
-- All 6 tables have 0 rows everywhere (they don't exist), so this is a
-- pure additive restoration with no backfill concerns.

-- -----------------------
-- 1) Normalized Claims
-- -----------------------
CREATE TABLE IF NOT EXISTS agent_claims (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    bank_id uuid NOT NULL REFERENCES banks(id),

    claim_hash text NOT NULL,

    topic text NOT NULL,
    predicate text NOT NULL,
    value_json jsonb NOT NULL,
    unit text,
    timeframe text,

    source_agent text NOT NULL,
    finding_id uuid REFERENCES agent_findings(id) ON DELETE SET NULL,
    evidence_json jsonb,
    sop_citations text[] DEFAULT '{}',

    confidence numeric(3,2) NOT NULL DEFAULT 0.50 CHECK (confidence >= 0 AND confidence <= 1),
    severity text NOT NULL DEFAULT 'info',

    created_at timestamptz DEFAULT now(),

    CONSTRAINT agent_claims_bank_id_check CHECK (bank_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_agent_claims_deal_id ON agent_claims(deal_id);
CREATE INDEX IF NOT EXISTS idx_agent_claims_hash ON agent_claims(deal_id, claim_hash);
CREATE INDEX IF NOT EXISTS idx_agent_claims_topic ON agent_claims(topic);
CREATE INDEX IF NOT EXISTS idx_agent_claims_severity ON agent_claims(severity);
CREATE INDEX IF NOT EXISTS idx_agent_claims_value_json ON agent_claims USING gin(value_json);
CREATE INDEX IF NOT EXISTS idx_agent_claims_evidence_json ON agent_claims USING gin(evidence_json);

ALTER TABLE agent_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny_all_agent_claims" ON agent_claims;
CREATE POLICY "deny_all_agent_claims" ON agent_claims FOR ALL USING (false);

COMMENT ON TABLE agent_claims IS 'Normalized atomic claims from agent findings - enables conflict detection';
COMMENT ON COLUMN agent_claims.claim_hash IS 'Stable hash for grouping conflicting claims about same topic';
COMMENT ON COLUMN agent_claims.severity IS 'Impact level: info (FYI), warning (concern), blocker (hard stop)';

-- -----------------------
-- 2) Conflict Sets
-- -----------------------
CREATE TABLE IF NOT EXISTS claim_conflict_sets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    bank_id uuid NOT NULL REFERENCES banks(id),

    claim_hash text NOT NULL,
    topic text NOT NULL,
    predicate text NOT NULL,
    timeframe text,
    unit text,

    num_claims int NOT NULL DEFAULT 0,
    num_agents int NOT NULL DEFAULT 0,
    has_blocker boolean NOT NULL DEFAULT false,

    status text NOT NULL DEFAULT 'open',

    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),

    CONSTRAINT claim_conflict_sets_bank_id_check CHECK (bank_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conflict_set_unique ON claim_conflict_sets(deal_id, claim_hash);
CREATE INDEX IF NOT EXISTS idx_conflict_sets_deal_id ON claim_conflict_sets(deal_id);
CREATE INDEX IF NOT EXISTS idx_conflict_sets_status ON claim_conflict_sets(status);

ALTER TABLE claim_conflict_sets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny_all_claim_conflict_sets" ON claim_conflict_sets;
CREATE POLICY "deny_all_claim_conflict_sets" ON claim_conflict_sets FOR ALL USING (false);

CREATE OR REPLACE FUNCTION update_conflict_sets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS claim_conflict_sets_updated_at ON claim_conflict_sets;
CREATE TRIGGER claim_conflict_sets_updated_at
    BEFORE UPDATE ON claim_conflict_sets
    FOR EACH ROW
    EXECUTE FUNCTION update_conflict_sets_updated_at();

COMMENT ON TABLE claim_conflict_sets IS 'Groups of conflicting claims requiring arbitration';
COMMENT ON COLUMN claim_conflict_sets.status IS 'open (unresolved), resolved (auto-chosen), needs_human (requires override)';

-- -----------------------
-- 3) Arbitration Decisions
-- -----------------------
CREATE TABLE IF NOT EXISTS arbitration_decisions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    bank_id uuid NOT NULL REFERENCES banks(id),

    claim_hash text NOT NULL,
    conflict_set_id uuid REFERENCES claim_conflict_sets(id) ON DELETE CASCADE,

    chosen_value_json jsonb,
    chosen_claim_id uuid REFERENCES agent_claims(id) ON DELETE SET NULL,

    decision_status text NOT NULL DEFAULT 'unresolved',
    rationale text,

    rule_trace_json jsonb,
    provenance_json jsonb,
    dissent_json jsonb,

    requires_human_review boolean NOT NULL DEFAULT false,
    created_by text NOT NULL DEFAULT 'system',
    override_reason text,

    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),

    CONSTRAINT arbitration_decisions_bank_id_check CHECK (bank_id IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_arbitration_unique ON arbitration_decisions(deal_id, claim_hash);
CREATE INDEX IF NOT EXISTS idx_arbitration_deal_id ON arbitration_decisions(deal_id);
CREATE INDEX IF NOT EXISTS idx_arbitration_status ON arbitration_decisions(decision_status);
CREATE INDEX IF NOT EXISTS idx_arbitration_needs_review ON arbitration_decisions(requires_human_review) WHERE requires_human_review = true;
CREATE INDEX IF NOT EXISTS idx_arbitration_rule_trace ON arbitration_decisions USING gin(rule_trace_json);
CREATE INDEX IF NOT EXISTS idx_arbitration_provenance ON arbitration_decisions USING gin(provenance_json);

ALTER TABLE arbitration_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny_all_arbitration_decisions" ON arbitration_decisions;
CREATE POLICY "deny_all_arbitration_decisions" ON arbitration_decisions FOR ALL USING (false);

DROP TRIGGER IF EXISTS arbitration_decisions_updated_at ON arbitration_decisions;
CREATE TRIGGER arbitration_decisions_updated_at
    BEFORE UPDATE ON arbitration_decisions
    FOR EACH ROW
    EXECUTE FUNCTION update_conflict_sets_updated_at();

COMMENT ON TABLE arbitration_decisions IS 'Final arbitrated values for each conflict set with full provenance';
COMMENT ON COLUMN arbitration_decisions.rule_trace_json IS 'Audit trail: which rules fired, weights applied, scores calculated';
COMMENT ON COLUMN arbitration_decisions.provenance_json IS 'Supporting claim IDs that agree with chosen value';
COMMENT ON COLUMN arbitration_decisions.dissent_json IS 'Non-chosen claims preserved for review';

-- -----------------------
-- 4) Claim hash helper (pgcrypto's digest() lives in the extensions
--    schema on this project, not public - explicit search_path avoids
--    the same "function does not exist" class of bug already found and
--    fixed for the pgp_sym_* RPCs in 20260605_d_etran_rpc.sql).
-- -----------------------
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
$$ LANGUAGE plpgsql IMMUTABLE SET search_path = public, extensions;

COMMENT ON FUNCTION generate_claim_hash IS 'Generates stable hash for grouping conflicting claims';

-- -----------------------
-- 5) Bank Overlays
-- -----------------------
CREATE TABLE IF NOT EXISTS bank_overlays (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bank_id uuid NOT NULL REFERENCES banks(id) ON DELETE CASCADE,

    version int NOT NULL,
    is_active boolean NOT NULL DEFAULT false,

    overlay_json jsonb NOT NULL,

    name text NOT NULL,
    description text,

    created_at timestamptz DEFAULT now(),
    created_by text,
    activated_at timestamptz,
    deactivated_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bank_overlays_unique ON bank_overlays(bank_id, version);
CREATE INDEX IF NOT EXISTS idx_bank_overlays_active ON bank_overlays(bank_id, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_bank_overlays_bank_id ON bank_overlays(bank_id);
CREATE INDEX IF NOT EXISTS idx_bank_overlays_json ON bank_overlays USING gin(overlay_json);

ALTER TABLE bank_overlays ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny_all_bank_overlays" ON bank_overlays;
CREATE POLICY "deny_all_bank_overlays" ON bank_overlays FOR ALL USING (false);

COMMENT ON TABLE bank_overlays IS 'Versioned bank-specific policy overlays (can only tighten SBA requirements)';
COMMENT ON COLUMN bank_overlays.overlay_json IS 'DSL config: constraints, triggers, doc requirements, arbitration overrides';
COMMENT ON COLUMN bank_overlays.is_active IS 'Only one version can be active per bank at a time';

-- -----------------------
-- 6) Overlay Application Log
-- -----------------------
CREATE TABLE IF NOT EXISTS overlay_application_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    bank_id uuid NOT NULL REFERENCES banks(id),

    overlay_id uuid NOT NULL REFERENCES bank_overlays(id) ON DELETE CASCADE,
    overlay_version int NOT NULL,

    triggered_rules jsonb,
    added_conditions text[],
    added_documents text[],
    requires_human_review_flags text[],

    adjusted_agent_weights jsonb,
    adjusted_thresholds jsonb,

    applied_at timestamptz DEFAULT now(),
    applied_by text DEFAULT 'system'
);

CREATE INDEX IF NOT EXISTS idx_overlay_log_deal_id ON overlay_application_log(deal_id);
CREATE INDEX IF NOT EXISTS idx_overlay_log_overlay_id ON overlay_application_log(overlay_id);
CREATE INDEX IF NOT EXISTS idx_overlay_log_applied_at ON overlay_application_log(applied_at DESC);

ALTER TABLE overlay_application_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny_all_overlay_application_log" ON overlay_application_log;
CREATE POLICY "deny_all_overlay_application_log" ON overlay_application_log FOR ALL USING (false);

COMMENT ON TABLE overlay_application_log IS 'Audit log of overlay applications to deals';
COMMENT ON COLUMN overlay_application_log.triggered_rules IS 'Which overlay rules matched deal state';

-- -----------------------
-- 7) Overlay-Generated Claims
-- -----------------------
CREATE TABLE IF NOT EXISTS overlay_generated_claims (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
    bank_id uuid NOT NULL REFERENCES banks(id),

    overlay_id uuid NOT NULL REFERENCES bank_overlays(id) ON DELETE CASCADE,
    rule_id text NOT NULL,

    claim_hash text NOT NULL,
    topic text NOT NULL,
    predicate text NOT NULL,
    value_json jsonb NOT NULL,

    constraint_type text,
    requirement_level text NOT NULL DEFAULT 'bank',

    created_at timestamptz DEFAULT now(),

    CONSTRAINT overlay_generated_claims_bank_id_check CHECK (bank_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_overlay_claims_deal_id ON overlay_generated_claims(deal_id);
CREATE INDEX IF NOT EXISTS idx_overlay_claims_overlay_id ON overlay_generated_claims(overlay_id);
CREATE INDEX IF NOT EXISTS idx_overlay_claims_hash ON overlay_generated_claims(claim_hash);

ALTER TABLE overlay_generated_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny_all_overlay_generated_claims" ON overlay_generated_claims;
CREATE POLICY "deny_all_overlay_generated_claims" ON overlay_generated_claims FOR ALL USING (false);

COMMENT ON TABLE overlay_generated_claims IS 'Claims generated by bank overlay rules (e.g., tighter DSCR requirements)';
COMMENT ON COLUMN overlay_generated_claims.requirement_level IS 'Source: SBA baseline vs bank overlay vs other regulation';
