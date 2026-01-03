-- Fix deal_documents.source CHECK constraint
-- 
-- PROBLEM: Existing constraint only allows: internal, borrower, system, sys
--          App writes normalized values including 'public' (from public_link)
--          Result: Storage upload succeeds, DB insert fails on constraint violation
-- 
-- SOLUTION: Add 'public' to allowed constraint values
--
-- Run in Supabase SQL Editor (production + preview environments)
-- Safe + idempotent: drops existing constraint if present, recreates with updated values

DO $$
DECLARE
  cname text;
BEGIN
  -- Find the constraint if it exists
  SELECT c.conname INTO cname
  FROM pg_constraint c
  JOIN pg_class t ON c.conrelid = t.oid
  JOIN pg_namespace n ON t.relnamespace = n.oid
  WHERE n.nspname = 'public'
    AND t.relname = 'deal_documents'
    AND c.contype = 'c'
    AND c.conname = 'deal_documents_source_check'
  LIMIT 1;

  -- Drop it if found
  IF cname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.deal_documents DROP CONSTRAINT ' || quote_ident(cname) || ';';
  END IF;
END $$;

-- Recreate with expanded allowed values
-- Maps to normalized values from normalizeDealDocSource():
--   banker_upload → internal
--   borrower_portal → borrower
--   public_link → public (NEW)
--   system_backfill → system
ALTER TABLE public.deal_documents
ADD CONSTRAINT deal_documents_source_check
CHECK (source = ANY (ARRAY['internal'::text, 'borrower'::text, 'public'::text, 'system'::text, 'sys'::text]));
