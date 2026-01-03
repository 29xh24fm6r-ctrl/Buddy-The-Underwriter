-- =============================================================================
-- CANONICAL DEAL CONVERGENCE - SQL FIXES
-- =============================================================================
-- 
-- Purpose: Fix RLS + bank context for deal_checklist_items
-- Root Cause: "failed to load checklist" was caused by missing bank context function
-- 
-- Run this in Supabase SQL Editor
-- Safe to run multiple times (idempotent)
-- 
-- =============================================================================

-- 1. Create canonical bank resolver function
-- This extracts bank_id from JWT claims and makes it available to RLS policies
create or replace function public.get_current_bank_id()
returns uuid
language sql
stable
security definer
as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'bank_id', '')::uuid;
$$;

comment on function public.get_current_bank_id() is 
  'Extracts bank_id from JWT claims for RLS policies. Returns NULL if not set.';

-- =============================================================================
-- 2. Enable RLS on deal_checklist_items (if not already enabled)
-- =============================================================================

alter table public.deal_checklist_items enable row level security;

-- =============================================================================
-- 3. Create bank-scoped SELECT policy
-- =============================================================================

drop policy if exists bank_select on public.deal_checklist_items;

create policy bank_select
on public.deal_checklist_items
for select
to authenticated
using (bank_id = public.get_current_bank_id());

comment on policy bank_select on public.deal_checklist_items is
  'Allow users to see only checklist items for their current bank';

-- =============================================================================
-- 4. Create bank-scoped INSERT policy
-- =============================================================================

drop policy if exists bank_insert on public.deal_checklist_items;

create policy bank_insert
on public.deal_checklist_items
for insert
to authenticated
with check (bank_id = public.get_current_bank_id());

-- =============================================================================
-- 5. Create bank-scoped UPDATE policy
-- =============================================================================

drop policy if exists bank_update on public.deal_checklist_items;

create policy bank_update
on public.deal_checklist_items
for update
to authenticated
using (bank_id = public.get_current_bank_id())
with check (bank_id = public.get_current_bank_id());

-- =============================================================================
-- 6. Create bank-scoped DELETE policy
-- =============================================================================

drop policy if exists bank_delete on public.deal_checklist_items;

create policy bank_delete
on public.deal_checklist_items
for delete
to authenticated
using (bank_id = public.get_current_bank_id());

-- =============================================================================
-- VERIFICATION QUERIES
-- =============================================================================

-- Check that function exists and works
select 
  proname as function_name,
  pg_get_functiondef(oid) as definition
from pg_proc 
where proname = 'get_current_bank_id';

-- Check RLS is enabled
select 
  schemaname,
  tablename,
  rowsecurity as rls_enabled
from pg_tables 
where tablename = 'deal_checklist_items';

-- Check policies exist
select 
  schemaname,
  tablename,
  policyname,
  cmd as operation,
  qual as using_expression,
  with_check as check_expression
from pg_policies 
where tablename = 'deal_checklist_items'
order by policyname;

-- =============================================================================
-- EXPECTED RESULTS AFTER RUNNING THIS MIGRATION
-- =============================================================================
-- 
-- ✅ get_current_bank_id() function exists
-- ✅ RLS enabled on deal_checklist_items
-- ✅ 4 policies created: bank_select, bank_insert, bank_update, bank_delete
-- ✅ "Failed to load checklist" error resolved
-- ✅ Checklist loads correctly with bank_id isolation
-- 
-- =============================================================================
