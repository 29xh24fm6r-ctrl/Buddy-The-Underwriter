-- 20260206174559_create_canonical_memo_narratives.sql
-- Cache table for AI-generated credit memo narrative sections.
-- Keyed by (deal_id, bank_id, input_hash) so identical inputs reuse cached narratives.

CREATE TABLE IF NOT EXISTS public.canonical_memo_narratives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL,
  bank_id UUID NOT NULL,
  input_hash TEXT NOT NULL,
  narratives JSONB NOT NULL,
  model TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (deal_id, bank_id, input_hash)
);

CREATE INDEX IF NOT EXISTS idx_cmn_deal_bank
  ON public.canonical_memo_narratives (deal_id, bank_id);
