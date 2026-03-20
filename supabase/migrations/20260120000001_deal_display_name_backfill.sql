-- 20260120_deal_display_name_backfill.sql
-- Ensure display_name exists and backfill missing values

begin;

alter table public.deals
  add column if not exists display_name text;

-- Backfill from borrower legal name (if borrower table exists), intake name, or fallback

do $$
declare
  borrower_id_exists boolean;
begin
  borrower_id_exists := exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'deals'
      and column_name = 'borrower_id'
  );

  if to_regclass('public.borrowers') is not null and borrower_id_exists then
    update public.deals d
    set display_name = coalesce(
      d.display_name,
      (select b.legal_name from public.borrowers b where b.id = d.borrower_id limit 1),
      (select i.borrower_name from public.deal_intake i where i.deal_id = d.id limit 1),
      d.borrower_name,
      d.name,
      'Deal – ' || to_char(d.created_at, 'YYYY-MM-DD')
    )
    where d.display_name is null;
  else
    update public.deals d
    set display_name = coalesce(
      d.display_name,
      (select i.borrower_name from public.deal_intake i where i.deal_id = d.id limit 1),
      d.borrower_name,
      d.name,
      'Deal – ' || to_char(d.created_at, 'YYYY-MM-DD')
    )
    where d.display_name is null;
  end if;

  update public.deals d
  set display_name = coalesce(
    d.display_name,
    d.borrower_name,
    d.name,
    'Deal – ' || to_char(d.created_at, 'YYYY-MM-DD')
  )
  where d.display_name is null;
end $$;

-- Refresh PostgREST schema cache
select pg_notify('pgrst', 'reload schema');

commit;
