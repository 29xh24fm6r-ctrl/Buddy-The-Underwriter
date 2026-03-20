-- Template Library System: Bank-standard request templates + learning integration
-- Enables banks to maintain a library of standard document requests
-- Deals can generate request lists from templates in one click
-- Learning loop ties priors to template_id (strongest signal)

begin;

-- 1) Bank-level template library
create table if not exists public.borrower_request_templates (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null,

  title text not null,
  category text null,
  description text null,

  -- optional: used by evidence ranking + learning
  doc_type text null,
  year_mode text not null default 'optional', -- 'optional' | 'required' | 'forbidden'

  sort_order int not null default 0,
  active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists borrower_request_templates_bank_id_idx
  on public.borrower_request_templates(bank_id);

create index if not exists borrower_request_templates_active_idx
  on public.borrower_request_templates(bank_id, active, sort_order);

-- 2) Add template_id to deal requests (ties requests to templates)
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='borrower_document_requests'
      and column_name='template_id'
  ) then
    alter table public.borrower_document_requests
      add column template_id uuid null references public.borrower_request_templates(id) on delete set null;
  end if;
end$$;

create index if not exists borrower_document_requests_template_id_idx
  on public.borrower_document_requests(template_id);

-- 3) Deal template application audit + idempotency
create table if not exists public.borrower_deal_template_apps (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null,
  template_id uuid not null references public.borrower_request_templates(id) on delete cascade,
  request_id uuid not null references public.borrower_document_requests(id) on delete cascade,

  created_at timestamptz not null default now()
);

create unique index if not exists borrower_deal_template_apps_unique
  on public.borrower_deal_template_apps(deal_id, template_id);

create index if not exists borrower_deal_template_apps_deal_id_idx
  on public.borrower_deal_template_apps(deal_id);

-- 4) Rename bank_match_hints → borrower_bank_match_priors (align with new naming)
-- Keep existing table, add template_id column
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='bank_match_hints'
  ) then
    alter table public.bank_match_hints rename to borrower_bank_match_priors;
  end if;
end$$;

-- Create table if it doesn't exist yet
create table if not exists public.borrower_bank_match_priors (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null,

  -- template-based priors (strongest signal)
  template_id uuid null references public.borrower_request_templates(id) on delete set null,

  -- label-based priors (fallback for non-templated requests)
  label text not null default '',
  label_tokens text[] not null default '{}'::text[],

  -- learned signals (cross-deal patterns)
  doc_type text null,
  year int null,

  keywords text[] not null default '{}'::text[],

  hit_count int not null default 1,
  last_used_at timestamptz null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Add template_id column to existing priors table if missing
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='borrower_bank_match_priors'
      and column_name='template_id'
  ) then
    alter table public.borrower_bank_match_priors
      add column template_id uuid null references public.borrower_request_templates(id) on delete set null;
  end if;
end$$;

-- Add label_tokens column if missing (for better label-based matching)
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='borrower_bank_match_priors'
      and column_name='label_tokens'
  ) then
    alter table public.borrower_bank_match_priors
      add column label_tokens text[] not null default '{}'::text[];
  end if;
end$$;

-- Add label column if missing
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='borrower_bank_match_priors'
      and column_name='label'
  ) then
    alter table public.borrower_bank_match_priors
      add column label text not null default '';
  end if;
end$$;

-- Drop old category column (replaced by label system)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='borrower_bank_match_priors'
      and column_name='category'
  ) then
    alter table public.borrower_bank_match_priors drop column category;
  end if;
end$$;

-- Drop old filename_tokens column (not needed for bank priors, only deal hints use it)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='borrower_bank_match_priors'
      and column_name='filename_tokens'
  ) then
    alter table public.borrower_bank_match_priors drop column filename_tokens;
  end if;
end$$;

-- Indexes for bank priors
create index if not exists borrower_bank_match_priors_bank_id_idx
  on public.borrower_bank_match_priors(bank_id);

create index if not exists borrower_bank_match_priors_template_idx
  on public.borrower_bank_match_priors(bank_id, template_id)
  where template_id is not null;

create index if not exists borrower_bank_match_priors_label_idx
  on public.borrower_bank_match_priors(bank_id, label, doc_type, year);

commit;
