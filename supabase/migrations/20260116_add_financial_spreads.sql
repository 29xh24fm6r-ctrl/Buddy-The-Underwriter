-- 20260116_add_financial_spreads.sql
-- Financial spreads: canonical extracted facts + rendered spreads + recompute queue
-- NOTE: Supabase SQL editor expects SQL only. Do not paste markdown like "##" headers or ``` fences.

-- Needed for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

BEGIN;

CREATE TABLE IF NOT EXISTS public.deal_financial_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id UUID NOT NULL,
  source_document_id UUID REFERENCES public.deal_documents(id) ON DELETE SET NULL,
  fact_type TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  fact_period_start DATE,
  fact_period_end DATE,
  fact_value_num NUMERIC,
  fact_value_text TEXT,
  currency TEXT DEFAULT 'USD',
  confidence NUMERIC,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS deal_financial_facts_deal_idx
  ON public.deal_financial_facts (deal_id);

CREATE INDEX IF NOT EXISTS deal_financial_facts_fact_idx
  ON public.deal_financial_facts (fact_type, fact_key);

-- Idempotency for re-extraction: allow upsert by natural identity.
CREATE UNIQUE INDEX IF NOT EXISTS deal_financial_facts_natural_uq
  ON public.deal_financial_facts (
    deal_id,
    bank_id,
    COALESCE(source_document_id, '00000000-0000-0000-0000-000000000000'::uuid),
    fact_type,
    fact_key,
    COALESCE(fact_period_start, '1900-01-01'::date),
    COALESCE(fact_period_end, '1900-01-01'::date)
  );

CREATE TABLE IF NOT EXISTS public.deal_spreads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id UUID NOT NULL,
  spread_type TEXT NOT NULL,
  spread_version INT NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'ready',
  inputs_hash TEXT,
  rendered_json JSONB NOT NULL,
  rendered_html TEXT,
  rendered_csv TEXT,
  error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS deal_spreads_deal_idx
  ON public.deal_spreads (deal_id, spread_type);

-- One current row per (deal, spread_type, version)
CREATE UNIQUE INDEX IF NOT EXISTS deal_spreads_unique
  ON public.deal_spreads (deal_id, bank_id, spread_type, spread_version);

-- Durable recompute queue (never block request paths)
CREATE TABLE IF NOT EXISTS public.deal_spread_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id UUID NOT NULL,
  source_document_id UUID REFERENCES public.deal_documents(id) ON DELETE SET NULL,
  requested_spread_types TEXT[] NOT NULL DEFAULT '{}'::text[],
  status TEXT NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED')),
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  attempt INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  leased_until TIMESTAMPTZ NULL,
  lease_owner TEXT NULL,
  error TEXT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_spread_jobs_next
  ON public.deal_spread_jobs(status, next_run_at);

CREATE INDEX IF NOT EXISTS idx_deal_spread_jobs_deal
  ON public.deal_spread_jobs(deal_id, created_at DESC);

COMMIT;
