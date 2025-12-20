-- 20251218_sba_package_builder.sql
-- Run as Role: postgres

create table if not exists public.sba_package_templates (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text null,
  created_at timestamptz not null default now()
);

create table if not exists public.sba_package_items (
  id uuid primary key default gen_random_uuid(),
  package_template_id uuid not null references public.sba_package_templates(id) on delete cascade,
  template_code text not null,
  title text not null,
  sort_order int not null default 0,
  applies_when jsonb null,
  required boolean not null default true,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sba_package_items_unique_pkg_template'
  ) then
    alter table public.sba_package_items
      add constraint sba_package_items_unique_pkg_template
      unique (package_template_id, template_code);
  end if;
end $$;

create index if not exists idx_sba_package_items_pkg
  on public.sba_package_items(package_template_id);

create index if not exists idx_sba_package_items_template_code
  on public.sba_package_items(template_code);

create table if not exists public.sba_package_runs (
  id uuid primary key default gen_random_uuid(),
  deal_id text not null,
  token text null,
  package_template_code text not null,
  status text not null default 'prepared', -- prepared | generated | failed
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sba_package_runs_deal_id
  on public.sba_package_runs(deal_id);

create index if not exists idx_sba_package_runs_created
  on public.sba_package_runs(created_at desc);

create table if not exists public.sba_package_run_items (
  id uuid primary key default gen_random_uuid(),
  package_run_id uuid not null references public.sba_package_runs(id) on delete cascade,
  template_code text not null,
  title text not null,
  sort_order int not null default 0,
  required boolean not null default true,
  fill_run_id uuid null,
  output_storage_path text null,
  output_file_name text null,
  output_mime_type text null default 'application/pdf',
  status text not null default 'prepared', -- prepared | generated | failed
  error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sba_pkg_run_items_run
  on public.sba_package_run_items(package_run_id);

create index if not exists idx_sba_pkg_run_items_template
  on public.sba_package_run_items(template_code);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_sba_package_runs_updated_at') then
    create trigger trg_sba_package_runs_updated_at
    before update on public.sba_package_runs
    for each row execute function public.set_updated_at();
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'trg_sba_package_run_items_updated_at') then
    create trigger trg_sba_package_run_items_updated_at
    before update on public.sba_package_run_items
    for each row execute function public.set_updated_at();
  end if;
end $$;

-- Seed base package template + items
insert into public.sba_package_templates (code, name, description)
values ('SBA_7A_BASE', 'SBA 7(a) Base Package', 'Core SBA forms package for 7(a) submissions')
on conflict (code) do nothing;

with pkg as (
  select id
  from public.sba_package_templates
  where code = 'SBA_7A_BASE'
  limit 1
)
insert into public.sba_package_items
  (package_template_id, template_code, title, sort_order, required, applies_when)
select
  pkg.id,
  x.template_code,
  x.title,
  x.sort_order,
  x.required,
  x.applies_when
from pkg
cross join (
  values
    ('SBA_1919', 'SBA Form 1919', 10, true,  '{"product":"7a"}'::jsonb),
    ('SBA_413',  'SBA Form 413 (PFS)', 20, true, '{"product":"7a"}'::jsonb),
    ('SBA_912',  'SBA Form 912', 30, false,'{"product":"7a"}'::jsonb),
    ('IRS_4506C','IRS Form 4506-C', 40, true,'{"product":"7a"}'::jsonb)
) as x(template_code, title, sort_order, required, applies_when)
on conflict on constraint sba_package_items_unique_pkg_template
do nothing;

-- Realtime (optional)
do $$
begin
  begin
    alter publication supabase_realtime add table public.sba_package_runs;
  exception when others then null;
  end;

  begin
    alter publication supabase_realtime add table public.sba_package_run_items;
  exception when others then null;
  end;
end $$;
