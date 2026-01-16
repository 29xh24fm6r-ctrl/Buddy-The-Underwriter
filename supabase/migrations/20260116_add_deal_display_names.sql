-- 20260116_add_deal_display_names.sql
-- Add human-readable deal naming fields

alter table public.deals
  add column if not exists display_name text,
  add column if not exists nickname text;

create index if not exists deals_display_name_idx on public.deals (display_name);
create index if not exists deals_nickname_idx on public.deals (nickname);
