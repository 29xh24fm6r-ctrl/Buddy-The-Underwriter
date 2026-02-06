-- 20260206162336_personal_spreads_schema.sql
-- Add owner_type + owner_entity_id to deal_financial_facts and deal_spreads,
-- and update unique indexes to include the owner columns.

-- ── deal_financial_facts ────────────────────────────────────────────────────
ALTER TABLE public.deal_financial_facts
  ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'DEAL',
  ADD COLUMN IF NOT EXISTS owner_entity_id UUID NULL;

CREATE INDEX IF NOT EXISTS deal_financial_facts_owner_idx
  ON public.deal_financial_facts (deal_id, owner_type, owner_entity_id);

-- Recreate the unique index to include owner columns (idempotent).
-- Must drop old one first if it exists without owner columns.
DROP INDEX IF EXISTS public.deal_financial_facts_natural_uq;
CREATE UNIQUE INDEX IF NOT EXISTS deal_financial_facts_natural_uq
  ON public.deal_financial_facts (
    deal_id,
    bank_id,
    COALESCE(source_document_id, '00000000-0000-0000-0000-000000000000'::uuid),
    fact_type,
    fact_key,
    COALESCE(fact_period_start, '1900-01-01'::date),
    COALESCE(fact_period_end, '1900-01-01'::date),
    owner_type,
    COALESCE(owner_entity_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

-- ── deal_spreads ────────────────────────────────────────────────────────────
ALTER TABLE public.deal_spreads
  ADD COLUMN IF NOT EXISTS owner_type TEXT NOT NULL DEFAULT 'DEAL',
  ADD COLUMN IF NOT EXISTS owner_entity_id UUID NULL;

-- Recreate the unique index to include owner columns.
DROP INDEX IF EXISTS public.deal_spreads_unique;
CREATE UNIQUE INDEX IF NOT EXISTS deal_spreads_unique
  ON public.deal_spreads (
    deal_id,
    bank_id,
    spread_type,
    spread_version,
    owner_type,
    COALESCE(owner_entity_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
