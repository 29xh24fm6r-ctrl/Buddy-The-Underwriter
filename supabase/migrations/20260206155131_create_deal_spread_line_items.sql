-- 20260206155131_create_deal_spread_line_items.sql
-- Normalized line items: one row per (spread × line_key × period_label).
-- Written by renderSpread() after each spread generation.

CREATE TABLE IF NOT EXISTS public.deal_spread_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id UUID NOT NULL REFERENCES public.banks(id) ON DELETE CASCADE,
  spread_type TEXT NOT NULL,
  owner_type TEXT NOT NULL DEFAULT 'DEAL'
    CHECK (owner_type IN ('DEAL','PERSONAL','GLOBAL')),
  owner_entity_id UUID NULL,
  section TEXT NOT NULL,
  line_key TEXT NOT NULL,
  label TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  period_label TEXT NOT NULL,
  value_num NUMERIC NULL,
  value_text TEXT NULL,
  is_formula BOOLEAN DEFAULT false,
  formula_expr TEXT NULL,
  source_document_id UUID NULL REFERENCES public.deal_documents(id),
  confidence NUMERIC NULL,
  provenance JSONB NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spread_line_items_deal_type
  ON public.deal_spread_line_items (deal_id, bank_id, spread_type);

CREATE UNIQUE INDEX IF NOT EXISTS idx_spread_line_items_natural_key
  ON public.deal_spread_line_items (deal_id, bank_id, spread_type, line_key, period_label);
