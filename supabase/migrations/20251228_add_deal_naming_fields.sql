-- Add deal naming fields (name, borrower_name)
-- Addresses schema cache error: "Could not find the `borrower_name` column"

-- Ensure UUID extension exists
create extension if not exists pgcrypto;

-- Ensure deals.id has default UUID generation
alter table public.deals
  alter column id set default gen_random_uuid();

alter table public.deals
  alter column id set not null;

-- Add naming columns if they don't exist
alter table public.deals
  add column if not exists name text,
  add column if not exists borrower_name text;

-- Add common fields if missing
alter table public.deals
  add column if not exists stage text,
  add column if not exists entity_type text,
  add column if not exists risk_score int default 0;

-- Backfill existing rows with sensible defaults
update public.deals
set name = coalesce(name, borrower_name, 'Untitled Deal')
where name is null;

-- Add indexes for search/list performance
create index if not exists deals_name_idx on public.deals (name);
create index if not exists deals_borrower_name_idx on public.deals (borrower_name);
create index if not exists deals_stage_idx on public.deals (stage);

-- Add timestamps if missing
alter table public.deals
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();
