-- Fix routing_class CHECK constraint drift.
--
-- The original 20260203 migration allows DOC_AI_ATOMIC but the TS code
-- (docTypeRouting.ts) writes GEMINI_STRUCTURED. DocAI was removed on 2026-02-24;
-- GEMINI_STRUCTURED is now the authoritative extraction routing class.
--
-- Idempotent: DROP IF EXISTS + re-ADD. Backfill any stale DOC_AI_ATOMIC rows.

-- Step 1: Backfill before constraint change (avoid CHECK violation)
UPDATE public.deal_documents
SET routing_class = 'GEMINI_STRUCTURED'
WHERE routing_class = 'DOC_AI_ATOMIC';

-- Step 2: Replace constraint
ALTER TABLE public.deal_documents
  DROP CONSTRAINT IF EXISTS deal_documents_routing_class_check;

ALTER TABLE public.deal_documents
  ADD CONSTRAINT deal_documents_routing_class_check
  CHECK (routing_class IS NULL OR routing_class IN (
    'GEMINI_STRUCTURED', 'GEMINI_PACKET', 'GEMINI_STANDARD'
  ));
