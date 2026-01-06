-- Production-safe: Add missing checklist columns
-- Run this in Supabase SQL Editor if checklist fails to load

-- Add missing document metadata columns (safe to rerun)
ALTER TABLE public.deal_checklist_items
  ADD COLUMN IF NOT EXISTS document_category text;

ALTER TABLE public.deal_checklist_items
  ADD COLUMN IF NOT EXISTS document_label text;

-- Backfill label for existing rows
UPDATE public.deal_checklist_items
SET document_label = checklist_key
WHERE document_label IS NULL;

-- Add index for efficient ordering
CREATE INDEX IF NOT EXISTS deal_checklist_items_deal_created_idx
  ON public.deal_checklist_items(deal_id, created_at);

-- Comments
COMMENT ON COLUMN public.deal_checklist_items.document_category IS 'Optional category for UI grouping';
COMMENT ON COLUMN public.deal_checklist_items.document_label IS 'Human-readable label, defaults to checklist_key';
