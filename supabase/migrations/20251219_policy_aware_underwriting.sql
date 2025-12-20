-- 20251219_policy_aware_underwriting.sql
begin;

create extension if not exists pgcrypto;

-- 1) Policy document chunks (text extracted from uploaded policy assets)
create table if not exists public.bank_policy_chunks (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  asset_id uuid not null references public.bank_assets(id) on delete cascade,
  chunk_index integer not null default 0,
  content text not null,
  page_num integer null,
  section text null,
  created_at timestamptz not null default now()
);

create index if not exists bank_policy_chunks_bank_asset_idx
  on public.bank_policy_chunks (bank_id, asset_id, chunk_index);

create index if not exists bank_policy_chunks_bank_created_idx
  on public.bank_policy_chunks (bank_id, created_at desc);

alter table public.bank_policy_chunks enable row level security;
-- no policies (service role writes; members read via rules below)
drop policy if exists bank_policy_chunks_select_member on public.bank_policy_chunks;
create policy bank_policy_chunks_select_member on public.bank_policy_chunks
for select using (
  exists (
    select 1 from public.bank_memberships m
    where m.bank_id = bank_policy_chunks.bank_id and m.user_id = auth.uid()
  )
);

-- 2) Policy rules (deterministic credit box)
create table if not exists public.bank_policy_rules (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  rule_key text not null,                  -- stable key, e.g. "cre.max_ltv"
  title text not null,
  description text null,

  scope jsonb not null default '{}'::jsonb, -- e.g. {"deal_type":["Commercial Real Estate","SBA 7(a)"]}
  predicate jsonb not null,                -- e.g. {"and":[{">":["ltv",0.80]},{"=":["property_type","OwnerOccupied"]}]}
  decision jsonb not null,                 -- e.g. {"result":"fail","message":"LTV exceeds policy max","requires_exception":true}

  severity text not null default 'hard' check (severity in ('hard','soft','info')),
  active boolean not null default true,

  created_by uuid null,
  created_at timestamptz not null default now(),

  unique (bank_id, rule_key)
);

create index if not exists bank_policy_rules_bank_active_idx
  on public.bank_policy_rules (bank_id, active, severity);

alter table public.bank_policy_rules enable row level security;

drop policy if exists bank_policy_rules_select_member on public.bank_policy_rules;
create policy bank_policy_rules_select_member on public.bank_policy_rules
for select using (
  exists (
    select 1 from public.bank_memberships m
    where m.bank_id = bank_policy_rules.bank_id and m.user_id = auth.uid()
  )
);

drop policy if exists bank_policy_rules_write_admin on public.bank_policy_rules;
create policy bank_policy_rules_write_admin on public.bank_policy_rules
for all using (
  exists (
    select 1 from public.bank_memberships m
    where m.bank_id = bank_policy_rules.bank_id and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
) with check (
  exists (
    select 1 from public.bank_memberships m
    where m.bank_id = bank_policy_rules.bank_id and m.user_id = auth.uid()
      and m.role in ('owner','admin')
  )
);

-- 3) Rule → policy citations (evidence pointers to chunks/pages)
create table if not exists public.bank_policy_rule_citations (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  rule_id uuid not null references public.bank_policy_rules(id) on delete cascade,
  asset_id uuid not null references public.bank_assets(id) on delete cascade,
  chunk_id uuid not null references public.bank_policy_chunks(id) on delete cascade,
  note text null,
  created_at timestamptz not null default now()
);

create index if not exists bank_policy_rule_citations_rule_idx
  on public.bank_policy_rule_citations (rule_id, created_at desc);

alter table public.bank_policy_rule_citations enable row level security;

drop policy if exists bank_policy_rule_citations_select_member on public.bank_policy_rule_citations;
create policy bank_policy_rule_citations_select_member on public.bank_policy_rule_citations
for select using (
  exists (
    select 1 from public.bank_memberships m
    where m.bank_id = bank_policy_rule_citations.bank_id and m.user_id = auth.uid()
  )
);

commit;
