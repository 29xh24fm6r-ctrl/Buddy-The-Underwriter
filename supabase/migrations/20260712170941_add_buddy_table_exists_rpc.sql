-- Reconstructed from live schema (supabase_migrations.schema_migrations) --
-- applied directly to the production project and never committed to the
-- repo. Captured verbatim for governance/reproducibility (see CRM audit,
-- 2026-07-16).

create or replace function public.buddy_table_exists(p_table_name text)
returns table("exists" boolean)
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from information_schema.tables t
    where t.table_schema = 'public'
      and t.table_name = p_table_name
  );
$$;

comment on function public.buddy_table_exists(text) is
  'Generic table-existence check used by feature modules that gracefully '
  'degrade when their underlying tables have not landed yet (e.g. '
  'franchiseComparator.ts). Returns a single-row table with an "exists" '
  'boolean column so callers can use .maybeSingle() and read data.exists.';
