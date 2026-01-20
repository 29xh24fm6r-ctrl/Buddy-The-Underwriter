-- 20260120_borrowers_table.sql
-- Canonical borrower entities (bank-scoped)

begin;

create table if not exists public.borrowers (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null,
  legal_name text not null,
  entity_type text null,
  primary_contact_name text null,
  primary_contact_email text null,
  ein text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists borrowers_bank_id_idx on public.borrowers(bank_id);
create index if not exists borrowers_legal_name_idx on public.borrowers(legal_name);
create index if not exists borrowers_ein_idx on public.borrowers(ein);
create index if not exists borrowers_primary_contact_email_idx on public.borrowers(primary_contact_email);

alter table public.borrowers enable row level security;

-- keep updated_at fresh
create or replace function public.touch_borrowers_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_touch_borrowers on public.borrowers;
create trigger trg_touch_borrowers
before update on public.borrowers
for each row execute function public.touch_borrowers_updated_at();

commit;
