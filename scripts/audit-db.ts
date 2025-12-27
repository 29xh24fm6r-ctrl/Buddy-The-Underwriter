import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

const url = "https://sglhiuizgugbnzkymwnk.supabase.co";
const key = "sb_secret_9ty_a6gY72C3QVOtSaA8Hw_KJu_81ie";

const supabase = createClient(url, key);

async function auditDatabase() {
  console.log('🔍 Auditing Supabase database...\n');
  
  const tables = [
    'deals', 'deal_files', 'documents', 
    'risk_runs', 'risk_factors', 'memo_runs',
    'evidence_documents', 'evidence_pages', 'evidence_chunks', 'evidence_catalog_items',
    'borrower_pack_uploads', 'pack_templates',
    'banks', 'bank_memberships',
    'reminders', 'reminder_runs'
  ];
  
  const results: any[] = [];
  
  for (const table of tables) {
    try {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });
      
      if (!error) {
        results.push({ table, count, status: 'exists' });
        console.log(`  ✅ ${table}: ${count ?? 0} rows`);
      } else {
        results.push({ table, error: error.message, status: 'error' });
        console.log(`  ❌ ${table}: ${error.message}`);
      }
    } catch (e: any) {
      results.push({ table, error: e.message, status: 'error' });
      console.log(`  ⚠️  ${table}: ${e.message}`);
    }
  }
  
  writeFileSync('.db_audit/table_counts.json', JSON.stringify(results, null, 2));
  console.log('\n✅ Wrote .db_audit/table_counts.json');
  
  // Write manual queries
  const manual = `-- Run these in Supabase SQL Editor

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
`;
  
  writeFileSync('.db_audit/manual_queries.sql', manual);
  console.log('✅ Wrote .db_audit/manual_queries.sql\n');
  console.log('📋 Next: Run manual_queries.sql in Supabase SQL Editor to get full schema info\n');
}

auditDatabase().catch(e => {
  console.error(e);
  process.exit(1);
});
