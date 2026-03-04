-- ═══════════════════════════════════════════════════════════════════════════════
-- Financial Integrity Hardening v1
--
-- Phase 1A: Fact identity hash + unique index (idempotent reruns)
-- Phase 1B: Document lineage constraint (no orphan facts)
-- Phase 2B: Entity-fact isolation (no cross-entity bleed)
-- Phase 3:  Spread run idempotency index
-- Phase 4:  Fact versioning (fact_version + is_superseded)
-- Phase 5:  Balance sheet reconciliation flag
-- Phase 6:  Material drift detection column
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Phase 1A: Fact Identity Hash ───────────────────────────────────────────
-- Deterministic hash computed from the natural key columns.
-- Makes fact identity explicit and auditable.
-- The existing deal_financial_facts_natural_uq already enforces uniqueness;
-- this hash provides a readable, portable identity for lineage tracking.

ALTER TABLE deal_financial_facts
ADD COLUMN IF NOT EXISTS fact_identity_hash text;

-- Compute hash from natural key columns using SQL
CREATE OR REPLACE FUNCTION public.compute_fact_identity_hash(
  p_document_id uuid,
  p_fact_type text,
  p_fact_key text,
  p_period_start date,
  p_period_end date,
  p_entity_id uuid
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(
    sha256(
      convert_to(
        COALESCE(p_document_id::text, '00000000-0000-0000-0000-000000000000') || '|' ||
        COALESCE(p_fact_type, '') || '|' ||
        COALESCE(p_fact_key, '') || '|' ||
        COALESCE(p_period_start::text, '1900-01-01') || '|' ||
        COALESCE(p_period_end::text, '1900-01-01') || '|' ||
        COALESCE(p_entity_id::text, '00000000-0000-0000-0000-000000000000'),
        'UTF8'
      )
    ),
    'hex'
  );
$$;

-- Backfill existing rows
UPDATE deal_financial_facts
SET fact_identity_hash = compute_fact_identity_hash(
  source_document_id,
  fact_type,
  fact_key,
  fact_period_start,
  fact_period_end,
  owner_entity_id
)
WHERE fact_identity_hash IS NULL;

-- Unique index on hash — prevents duplicate facts even across concurrent writes
CREATE UNIQUE INDEX IF NOT EXISTS unique_fact_identity
ON deal_financial_facts(fact_identity_hash)
WHERE fact_identity_hash IS NOT NULL;

GRANT EXECUTE ON FUNCTION public.compute_fact_identity_hash TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_fact_identity_hash TO service_role;

-- ── Phase 1B: Document Lineage Constraint ──────────────────────────────────
-- Every fact must trace back to a source document.
-- The sentinel UUID (00000000-...) counts as "present" for backfill/structural facts.
-- This prevents orphan facts that can't be audited.

ALTER TABLE deal_financial_facts
ADD CONSTRAINT fact_requires_document
CHECK (source_document_id IS NOT NULL);

-- ── Phase 2B: Entity-Fact Isolation ────────────────────────────────────────
-- Every fact must have an explicit owner_type.
-- owner_entity_id uses sentinel UUID for DEAL-level facts.
-- This prevents cross-entity fact bleed in multi-entity deals.

ALTER TABLE deal_financial_facts
ADD CONSTRAINT fact_requires_owner_type
CHECK (owner_type IS NOT NULL AND owner_type IN ('DEAL', 'PERSONAL', 'GLOBAL'));

ALTER TABLE deal_financial_facts
ADD CONSTRAINT fact_requires_entity
CHECK (owner_entity_id IS NOT NULL);

-- ── Phase 3: Spread Run Idempotency ────────────────────────────────────────
-- Prevent duplicate spread runs for the same reason on the same day.
-- Active runs (queued/running) are the ones that matter for dedup.

-- Helper: IMMUTABLE date extractor (required for index expressions on timestamptz)
CREATE OR REPLACE FUNCTION public.to_date_immutable(ts timestamptz)
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ts::date;
$$;

GRANT EXECUTE ON FUNCTION public.to_date_immutable TO authenticated;
GRANT EXECUTE ON FUNCTION public.to_date_immutable TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS unique_active_spread_run
ON deal_spread_runs(deal_id, run_reason, to_date_immutable(created_at))
WHERE status IN ('queued', 'running');

-- ── Phase 4: Fact Versioning ───────────────────────────────────────────────
-- Track which facts are current vs superseded.
-- When extraction reruns, old facts get marked superseded.
-- Spread runs can reference the fact_version that produced them.

ALTER TABLE deal_financial_facts
ADD COLUMN IF NOT EXISTS fact_version uuid DEFAULT gen_random_uuid();

ALTER TABLE deal_financial_facts
ADD COLUMN IF NOT EXISTS is_superseded boolean NOT NULL DEFAULT false;

-- Index for fast queries on current (non-superseded) facts
CREATE INDEX IF NOT EXISTS idx_facts_current
ON deal_financial_facts(deal_id, fact_type, fact_key)
WHERE is_superseded = false;

-- Track which fact snapshot a spread run consumed
ALTER TABLE deal_spread_runs
ADD COLUMN IF NOT EXISTS fact_snapshot_hash text;

-- ── Phase 5: Balance Sheet Reconciliation Flag ─────────────────────────────
-- Track whether the extracted balance sheet passes the A = L + E check.
-- This is stamped by the validation gate and surfaced in the UI.

ALTER TABLE deal_financial_facts
ADD COLUMN IF NOT EXISTS reconciliation_status text;

-- ── Phase 6: Material Drift Detection ──────────────────────────────────────
-- When extraction reruns on the same document, track the delta.
-- If material drift detected, flag for review.

ALTER TABLE deal_financial_facts
ADD COLUMN IF NOT EXISTS prior_value_num numeric;

ALTER TABLE deal_financial_facts
ADD COLUMN IF NOT EXISTS drift_pct numeric;
