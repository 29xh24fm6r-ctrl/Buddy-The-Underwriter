#!/usr/bin/env node
// Run migration via Supabase client
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const migrations = [
  `ALTER TABLE public.deal_checklist_items ADD COLUMN IF NOT EXISTS document_category text`,
  `ALTER TABLE public.deal_checklist_items ADD COLUMN IF NOT EXISTS document_label text`,
  `UPDATE public.deal_checklist_items SET document_label = checklist_key WHERE document_label IS NULL`,
  `CREATE INDEX IF NOT EXISTS deal_checklist_items_deal_created_idx ON public.deal_checklist_items(deal_id, created_at)`,
  `COMMENT ON COLUMN public.deal_checklist_items.document_category IS 'Optional category for UI grouping'`,
  `COMMENT ON COLUMN public.deal_checklist_items.document_label IS 'Human-readable label, defaults to checklist_key'`,
];

console.log('🔄 Running migration...\n');

for (const sql of migrations) {
  console.log(`   ${sql.substring(0, 80)}...`);
  const { error } = await supabase.rpc('exec_sql', { query: sql }).catch(() => ({ error: 'RPC not available' }));
  if (error) {
    console.log(`   ⚠️  Could not execute via RPC (expected - Supabase doesn't expose exec_sql)`);
    break;
  }
}

console.log('\n⚠️  Direct SQL execution not available via Supabase client.');
console.log('📋 Please run the migration manually in Supabase SQL Editor:');
console.log('👉 https://supabase.com/dashboard/project/sglhiuizgugbnzkymwnk/sql/new\n');
console.log('SQL to copy:\n');
console.log(migrations.join(';\n\n') + ';');

process.exit(0);
