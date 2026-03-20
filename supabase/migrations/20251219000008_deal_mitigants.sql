-- 20251219_deal_mitigants.sql
-- Mitigant completion tracking per deal
begin;

create extension if not exists pgcrypto;

create table if not exists public.deal_mitigants (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null references public.banks(id) on delete cascade,

  mitigant_key text not null,
  mitigant_label text not null,

  -- why this mitigant exists
  reason_rule_keys text[] not null default '{}'::text[],

  -- status
  status text not null default 'open' check (status in ('open','satisfied','waived')),
  satisfied_at timestamptz null,
  satisfied_by uuid null,
  note text null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (deal_id, mitigant_key)
);

create index if not exists deal_mitigants_deal_idx
  on public.deal_mitigants (deal_id, status, created_at desc);

create index if not exists deal_mitigants_bank_idx
  on public.deal_mitigants (bank_id, status, created_at desc);

-- Keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_deal_mitigants_updated_at on public.deal_mitigants;
create trigger trg_deal_mitigants_updated_at
before update on public.deal_mitigants
for each row execute function public.set_updated_at();

-- RLS: members of bank can read; writes only via app (server) or admins
alter table public.deal_mitigants enable row level security;

drop policy if exists deal_mitigants_select_member on public.deal_mitigants;
create policy deal_mitigants_select_member on public.deal_mitigants
for select using (
  exists (
    select 1 from public.bank_memberships m
    where m.bank_id = deal_mitigants.bank_id and m.user_id = auth.uid()
  )
);

drop policy if exists deal_mitigants_write_admin on public.deal_mitigants;
create policy deal_mitigants_write_admin on public.deal_mitigants
for all using (
  exists (
    select 1 from public.bank_memberships m
    where m.bank_id = deal_mitigants.bank_id and m.user_id = auth.uid()
      and m.role in ('owner','admin','member')
  )
) with check (
  exists (
    select 1 from public.bank_memberships m
    where m.bank_id = deal_mitigants.bank_id and m.user_id = auth.uid()
      and m.role in ('owner','admin','member')
  )
);

commit;
