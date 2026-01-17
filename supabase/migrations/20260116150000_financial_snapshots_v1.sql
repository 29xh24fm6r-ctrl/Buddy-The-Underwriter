-- ============================================================
-- FINANCIAL SNAPSHOTS v1: Versioned snapshot + decisions
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1) Versioned financial snapshots (immutable)
CREATE TABLE IF NOT EXISTS public.financial_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id UUID NOT NULL,

  as_of_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  snapshot_hash TEXT NULL,
  derived_from_event_id UUID NULL,

  snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS financial_snapshots_deal_id_idx
  ON public.financial_snapshots(deal_id);

CREATE INDEX IF NOT EXISTS financial_snapshots_bank_id_idx
  ON public.financial_snapshots(bank_id);

CREATE INDEX IF NOT EXISTS financial_snapshots_created_at_idx
  ON public.financial_snapshots(created_at DESC);

CREATE INDEX IF NOT EXISTS financial_snapshots_hash_idx
  ON public.financial_snapshots(snapshot_hash);

-- 2) Snapshot decisions (stress + SBA + narrative)
CREATE TABLE IF NOT EXISTS public.financial_snapshot_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  financial_snapshot_id UUID NOT NULL REFERENCES public.financial_snapshots(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id UUID NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  inputs_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  stress_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  sba_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  narrative_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS financial_snapshot_decisions_snapshot_idx
  ON public.financial_snapshot_decisions(financial_snapshot_id);

CREATE INDEX IF NOT EXISTS financial_snapshot_decisions_deal_idx
  ON public.financial_snapshot_decisions(deal_id);

CREATE INDEX IF NOT EXISTS financial_snapshot_decisions_created_at_idx
  ON public.financial_snapshot_decisions(created_at DESC);

-- 3) RLS: deny-by-default (server uses service role)
ALTER TABLE public.financial_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_snapshot_decisions ENABLE ROW LEVEL SECURITY;

-- 4) Immutability (no updates after insert)
CREATE OR REPLACE FUNCTION public.block_financial_snapshot_updates()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'financial_snapshot is immutable and cannot be modified';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_block_financial_snapshot_updates ON public.financial_snapshots;
CREATE TRIGGER trg_block_financial_snapshot_updates
BEFORE UPDATE ON public.financial_snapshots
FOR EACH ROW EXECUTE FUNCTION public.block_financial_snapshot_updates();

CREATE OR REPLACE FUNCTION public.block_financial_snapshot_decision_updates()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW IS DISTINCT FROM OLD) THEN
    RAISE EXCEPTION 'financial_snapshot_decision is immutable and cannot be modified';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_block_financial_snapshot_decision_updates ON public.financial_snapshot_decisions;
CREATE TRIGGER trg_block_financial_snapshot_decision_updates
BEFORE UPDATE ON public.financial_snapshot_decisions
FOR EACH ROW EXECUTE FUNCTION public.block_financial_snapshot_decision_updates();

