-- Reconstructed from live schema (pg_proc) -- can_access_deal() exists on
-- the production project but was never defined in any tracked migration
-- (not found in supabase_migrations.schema_migrations either, meaning it
-- was created directly via the SQL editor/MCP at some point before
-- 20260507160056_deal_reconciliation_findings.sql, which is the earliest
-- migration that references it). Captured verbatim, as create-or-replace,
-- for governance/reproducibility (see CRM audit, 2026-07-16).

create or replace function public.can_access_deal(p_deal_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.deals d
    join public.bank_user_memberships m
      on m.bank_id = d.bank_id
    where d.id = p_deal_id
      and m.user_id = auth.uid()
  )
  or exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = auth.uid()
  );
$function$;
