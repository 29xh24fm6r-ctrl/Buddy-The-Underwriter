-- Run these in Supabase SQL Editor

-- 1. Extensions (check for pgvector)
SELECT extname, extversion FROM pg_extension ORDER BY extname;

-- 2. Evidence Tables Schema (if they exist)
SELECT 
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('evidence_documents', 'evidence_pages', 'evidence_chunks', 'evidence_catalog_items')
ORDER BY table_name, ordinal_position;

-- 3. RLS Status for all tables
SELECT n.nspname as schema, c.relname as table, c.relrowsecurity as rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind='r' AND n.nspname='public'
ORDER BY table;

-- 4. Policies
SELECT schemaname, tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE schemaname='public'
ORDER BY tablename, policyname;

-- 5. Existing vector/embedding columns
SELECT table_name, column_name, udt_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (column_name LIKE '%embed%' OR column_name LIKE '%vector%')
ORDER BY table_name;
