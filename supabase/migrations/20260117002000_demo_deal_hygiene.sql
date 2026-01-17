alter table public.deals
  add column if not exists is_demo boolean not null default false;

alter table public.deals
  add column if not exists archived_at timestamptz;

create index if not exists deals_is_demo_idx on public.deals (is_demo);
create index if not exists deals_archived_at_idx on public.deals (archived_at);
