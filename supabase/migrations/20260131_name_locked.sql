-- Add name_locked flag to deals and deal_documents.
-- When true, automatic naming derivation must NOT overwrite the name.
-- Set to true on manual rename; defaults to false.

-- ─── 1. deals ────────────────────────────────────────────────────────────────

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS name_locked BOOLEAN NOT NULL DEFAULT false;

-- ─── 2. deal_documents ───────────────────────────────────────────────────────

ALTER TABLE public.deal_documents
  ADD COLUMN IF NOT EXISTS name_locked BOOLEAN NOT NULL DEFAULT false;

-- Backfill: any row that was manually named should be locked
UPDATE public.deals
SET name_locked = true
WHERE naming_method = 'manual';

UPDATE public.deal_documents
SET name_locked = true
WHERE naming_method = 'manual';
