-- 20251219_conditions_generator.sql
-- Conditions-to-Close generator from policy mitigants
begin;

create extension if not exists pgcrypto;

-- -----------------------------
-- 1) Conditions-to-Close table
-- -----------------------------
create table if not exists public.deal_conditions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null references public.banks(id) on delete cascade,

  title text not null,
  description text null,

  category text not null default 'policy' check (category in ('policy','credit','legal','closing','other')),
  status text not null default 'open' check (status in ('open','satisfied','waived','rejected')),

  -- optional: tie back to mitigant
  source text not null default 'policy' check (source in ('policy','manual','system')),
  source_key text null, -- mitigant_key (unique per deal)

  -- docs we want borrower to upload
  required_docs jsonb not null default '[]'::jsonb,  -- [{key,label,optional}]
  due_date timestamptz null,

  -- borrower messaging (draft)
  borrower_message_subject text null,
  borrower_message_body text null,

  -- reminder subscription id (if created)
  reminder_subscription_id uuid null,

  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (deal_id, source, source_key)
);

create index if not exists deal_conditions_deal_idx
  on public.deal_conditions (deal_id, status, created_at desc);

create index if not exists deal_conditions_bank_idx
  on public.deal_conditions (bank_id, status, created_at desc);

-- updated_at trigger (reuse if you already created set_updated_at)
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_deal_conditions_updated_at on public.deal_conditions;
create trigger trg_deal_conditions_updated_at
before update on public.deal_conditions
for each row execute function public.set_updated_at();

-- -----------------------------
-- 2) Condition actions audit (optional but institutional)
-- -----------------------------
create table if not exists public.deal_condition_events (
  id uuid primary key default gen_random_uuid(),
  condition_id uuid not null references public.deal_conditions(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null references public.banks(id) on delete cascade,

  action text not null,   -- created|status_change|message_edit|doc_update
  payload jsonb not null default '{}'::jsonb,
  created_by uuid null,
  created_at timestamptz not null default now()
);

create index if not exists deal_condition_events_condition_idx
  on public.deal_condition_events (condition_id, created_at desc);

-- -----------------------------
-- 3) RLS
-- -----------------------------
alter table public.deal_conditions enable row level security;
alter table public.deal_condition_events enable row level security;

drop policy if exists deal_conditions_select_member on public.deal_conditions;
create policy deal_conditions_select_member on public.deal_conditions
for select using (
  exists (
    select 1 from public.bank_memberships m
    where m.bank_id = deal_conditions.bank_id and m.user_id = auth.uid()
  )
);

drop policy if exists deal_conditions_write_member on public.deal_conditions;
create policy deal_conditions_write_member on public.deal_conditions
for all using (
  exists (
    select 1 from public.bank_memberships m
    where m.bank_id = deal_conditions.bank_id and m.user_id = auth.uid()
      and m.role in ('owner','admin','member')
  )
) with check (
  exists (
    select 1 from public.bank_memberships m
    where m.bank_id = deal_conditions.bank_id and m.user_id = auth.uid()
      and m.role in ('owner','admin','member')
  )
);

drop policy if exists deal_condition_events_select_member on public.deal_condition_events;
create policy deal_condition_events_select_member on public.deal_condition_events
for select using (
  exists (
    select 1 from public.bank_memberships m
    where m.bank_id = deal_condition_events.bank_id and m.user_id = auth.uid()
  )
);

drop policy if exists deal_condition_events_write_member on public.deal_condition_events;
create policy deal_condition_events_write_member on public.deal_condition_events
for insert with check (
  exists (
    select 1 from public.bank_memberships m
    where m.bank_id = deal_condition_events.bank_id and m.user_id = auth.uid()
      and m.role in ('owner','admin','member')
  )
);

commit;
