-- Verify deal_documents.source constraint after migration
-- Copy/paste into Supabase SQL Editor after running migration

-- 1. Check constraint definition
SELECT
  conname as constraint_name,
  pg_get_constraintdef(oid) as definition
FROM pg_constraint
WHERE conrelid = 'public.deal_documents'::regclass
  AND conname = 'deal_documents_source_check';

-- 2. Check current source values distribution
SELECT
  source,
  count(*) AS ct
FROM public.deal_documents
GROUP BY source
ORDER BY ct DESC;

-- 3. Check recent uploads (last 50)
SELECT
  id,
  deal_id,
  source,
  document_key,
  original_filename,
  storage_path,
  created_at
FROM public.deal_documents
ORDER BY created_at DESC
LIMIT 50;
