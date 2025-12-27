#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'fs';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Missing SUPABASE credentials in environment');
  process.exit(1);
}

const supabase = createClient(url, key);

async function runQuery(sql, outputFile) {
  try {
    const { data, error } = await supabase.rpc('exec_sql', { query: sql });
    if (error) {
      // Try direct query if exec_sql doesn't exist
      const { data: data2, error: error2 } = await supabase.from('_').select('*').limit(0);
      // Use fetch API instead
      const response = await fetch(`${url}/rest/v1/rpc/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': key,
          'Authorization': `Bearer ${key}`
        },
        body: JSON.stringify({ query: sql })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      
      const result = await response.json();
      writeFileSync(outputFile, JSON.stringify(result, null, 2));
      console.log(`✅ Wrote ${outputFile}`);
      return;
    }
    writeFileSync(outputFile, JSON.stringify(data, null, 2));
    console.log(`✅ Wrote ${outputFile}`);
  } catch (e) {
    console.error(`❌ ${outputFile}: ${e.message}`);
    writeFileSync(outputFile, `ERROR: ${e.message}\n${e.stack}`);
  }
}

// Simpler approach: just query tables we know exist
async function auditDatabase() {
  console.log('🔍 Auditing Supabase database...\n');
  
  // 1. List all tables in public schema
  const tablesQuery = `
    select table_name, table_type 
    from information_schema.tables 
    where table_schema = 'public' 
    order by table_name;
  `;
  
  // 2. Extensions
  const extensionsQuery = `
    select extname, extversion 
    from pg_extension 
    order by extname;
  `;
  
  // 3. Table counts
  const countsQuery = `
    select schemaname, relname as table, n_live_tup as approx_rows
    from pg_stat_user_tables
    order by approx_rows desc, table asc;
  `;
  
  // 4. RLS status
  const rlsQuery = `
    select n.nspname as schema, c.relname as table, c.relrowsecurity as rls_enabled
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind='r' and n.nspname='public'
    order by table;
  `;
  
  // 5. Policies
  const policiesQuery = `
    select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
    from pg_policies
    where schemaname='public'
    order by tablename, policyname;
  `;
  
  // Execute via PostgreSQL connection pooler
  try {
    // Use SQL API if available
    const postgresUrl = url.replace('https://', 'postgres://postgres:');
    console.log(`Connecting to: ${url}`);
    
    // Fallback: query specific tables we care about
    const tables = [
      'deals', 'deal_files', 'documents', 
      'risk_runs', 'risk_factors', 'memo_runs',
      'evidence_documents', 'evidence_pages', 'evidence_chunks', 'evidence_catalog_items',
      'borrower_pack_uploads', 'pack_templates'
    ];
    
    const results = {
      tables: [],
      extensions: 'MANUAL QUERY NEEDED',
      policies: 'MANUAL QUERY NEEDED',
      rls: 'MANUAL QUERY NEEDED'
    };
    
    for (const table of tables) {
      try {
        const { count, error } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true });
        
        if (!error) {
          results.tables.push({ table, count });
          console.log(`  ✅ ${table}: ${count} rows`);
        } else {
          console.log(`  ❌ ${table}: ${error.message}`);
        }
      } catch (e) {
        console.log(`  ⚠️  ${table}: ${e.message}`);
      }
    }
    
    writeFileSync('.db_audit/table_counts.json', JSON.stringify(results, null, 2));
    console.log('\n✅ Wrote .db_audit/table_counts.json');
    
    // Write instructions for manual queries
    const manual = `
# Manual DB Queries (run these in Supabase SQL Editor)

## 1. Extensions
${extensionsQuery}

## 2. All Tables
${tablesQuery}

## 3. Table Counts
${countsQuery}

## 4. RLS Status
${rlsQuery}

## 5. Policies
${policiesQuery}

## 6. Evidence Tables Schema
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
`;
    
    writeFileSync('.db_audit/manual_queries.sql', manual);
    console.log('✅ Wrote .db_audit/manual_queries.sql');
    console.log('\n📋 Please run the queries in manual_queries.sql in your Supabase SQL Editor');
    
  } catch (e) {
    console.error('❌ Database audit failed:', e.message);
    process.exit(1);
  }
}

auditDatabase().catch(e => {
  console.error(e);
  process.exit(1);
});
