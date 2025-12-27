import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';
import * as dotenv from 'dotenv';

// Load .env.local
dotenv.config({ path: '.env.local' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE credentials');
  console.error('URL:', url);
  console.error('KEY:', key ? '***' + key.slice(-10) : 'undefined');
  process.exit(1);
}

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
  
  // Check for pgvector
  console.log('\n🔍 Checking for pgvector extension...');
  const { data: hasVector, error: extError } = await supabase
    .rpc('has_extension', { ext: 'vector' });
  
  if (!extError && hasVector) {
    console.log('  ✅ pgvector found');
    writeFileSync('.db_audit/pgvector_status.txt', 'pgvector is INSTALLED');
  } else {
    console.log('  ❌ pgvector not found - will need to install');
    writeFileSync('.db_audit/pgvector_status.txt', 'pgvector NOT INSTALLED');
  }
  
  // Write manual queries
  const manual = `-- Run these in Supabase SQL Editor

-- 1. Extensions
SELECT extname, extversion FROM pg_extension ORDER BY extname;

-- 2. Evidence Tables Schema
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

-- 3. RLS Status
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

-- 5. Check if pgvector is installed
SELECT * FROM pg_extension WHERE extname = 'vector';
`;
  
  writeFileSync('.db_audit/manual_queries.sql', manual);
  console.log('✅ Wrote .db_audit/manual_queries.sql\n');
}

auditDatabase().catch(e => {
  console.error(e);
  process.exit(1);
});
