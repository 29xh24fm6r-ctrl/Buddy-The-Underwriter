-- ============================================================
-- SAFE MIGRATION: NEW TABLES ONLY (NO deal_events changes)
-- - decision_snapshots (immutable decision audit trail)
-- - decision_overrides (explicit human overrides, visible & logged)
-- - policy_chunk_versions (optional policy snapshotting)
-- ============================================================

-- 1) Decision snapshot: immutable record of a credit decision
CREATE TABLE IF NOT EXISTS public.decision_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id UUID NULL,

  -- Narrative + status
  status TEXT NOT NULL DEFAULT 'proposed', -- proposed|final|void
  decision TEXT NOT NULL,                 -- approve|approve_with_conditions|decline|needs_more_info
  decision_summary TEXT NULL,
  confidence NUMERIC NULL,                -- 0..1
  confidence_explanation TEXT NULL,

  -- Snapshot payloads (immutable)
  inputs_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence_snapshot_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  policy_snapshot_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  policy_eval_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  exceptions_json JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Provenance
  model_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  hash TEXT NULL
);

CREATE INDEX IF NOT EXISTS decision_snapshots_deal_id_idx ON public.decision_snapshots(deal_id);
CREATE INDEX IF NOT EXISTS decision_snapshots_created_at_idx ON public.decision_snapshots(created_at DESC);

-- 2) Human overrides: explicit, visible, celebrated
CREATE TABLE IF NOT EXISTS public.decision_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL,
  decision_snapshot_id UUID NULL REFERENCES public.decision_snapshots(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id UUID NULL,

  -- What changed
  field_path TEXT NOT NULL,  -- e.g. "decision", "inputs.annual_revenue", "policy_eval.dsct"
  old_value JSONB NULL,
  new_value JSONB NULL,

  -- Why / governance
  reason TEXT NOT NULL,
  justification TEXT NULL,
  severity TEXT NOT NULL DEFAULT 'normal', -- normal|material
  requires_review BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS decision_overrides_deal_id_idx ON public.decision_overrides(deal_id);
CREATE INDEX IF NOT EXISTS decision_overrides_snapshot_id_idx ON public.decision_overrides(decision_snapshot_id);

-- 3) OPTIONAL: Policy snapshot versions
CREATE TABLE IF NOT EXISTS public.policy_chunk_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id UUID NULL,
  chunk_key TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by_user_id UUID NULL,
  content TEXT NOT NULL,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS policy_chunk_versions_uniq 
  ON public.policy_chunk_versions(chunk_key, version);

-- 4) RLS (minimal safe defaults - adapt to your tenant/bank scoping later)
ALTER TABLE public.decision_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.decision_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_chunk_versions ENABLE ROW LEVEL SECURITY;

-- Temporary policies: authenticated users can read/write
-- Replace with proper tenant scoping once stable
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='decision_snapshots' AND policyname='decision_snapshots_rw') THEN
    CREATE POLICY decision_snapshots_rw ON public.decision_snapshots
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='decision_overrides' AND policyname='decision_overrides_rw') THEN
    CREATE POLICY decision_overrides_rw ON public.decision_overrides
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='policy_chunk_versions' AND policyname='policy_chunk_versions_rw') THEN
    CREATE POLICY policy_chunk_versions_rw ON public.policy_chunk_versions
      FOR ALL
      TO authenticated
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;
