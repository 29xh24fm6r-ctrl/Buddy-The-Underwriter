-- ============================================================
-- PRICING V2: Explainability + Quote Locking + Memo Export
-- ============================================================

-- 1) Extend deal_pricing_quotes for locking + underwriting snapshot linkage
alter table if exists public.deal_pricing_quotes
  add column if not exists status text not null default 'draft', -- draft|locked|void
  add column if not exists locked_at timestamptz null,
  add column if not exists locked_by text null,
  add column if not exists underwriting_snapshot_id uuid null, -- optional link
  add column if not exists lock_reason text null;

create index if not exists deal_pricing_quotes_status_idx
  on public.deal_pricing_quotes(status);

create index if not exists deal_pricing_quotes_underwriting_snapshot_idx
  on public.deal_pricing_quotes(underwriting_snapshot_id);

-- 2) Explainability: normalized by quote_id (one row per quote)
-- Store both a human-readable summary and a structured breakdown for UI.
create table if not exists public.deal_pricing_explainability (
  quote_id uuid primary key references public.deal_pricing_quotes(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Structured breakdown (bps, rules, drivers, missing inputs, confidence)
  breakdown_json jsonb not null default '{}'::jsonb,

  -- Optional: short narrative for banker/committee
  narrative text null
);

-- updated_at trigger (reuse existing function if present)
do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_deal_pricing_explainability_updated_at'
  ) then
    create trigger trg_deal_pricing_explainability_updated_at
    before update on public.deal_pricing_explainability
    for each row execute function public.set_updated_at();
  end if;
end $$;

-- 3) Memo exports: store immutable memo blocks for locked quotes
-- (Committee-safe: memo text is frozen when quote is locked)
create table if not exists public.deal_pricing_memo_blocks (
  quote_id uuid primary key references public.deal_pricing_quotes(id) on delete cascade,
  created_at timestamptz not null default now(),
  content_md text not null,
  content_json jsonb not null default '{}'::jsonb
);

-- ------------------------------------------------------------
-- RLS: deny all (server routes only)
-- ------------------------------------------------------------
alter table public.deal_pricing_explainability enable row level security;
alter table public.deal_pricing_memo_blocks enable row level security;

drop policy if exists deal_pricing_explainability_none on public.deal_pricing_explainability;
create policy deal_pricing_explainability_none on public.deal_pricing_explainability
for all using (false) with check (false);

drop policy if exists deal_pricing_memo_blocks_none on public.deal_pricing_memo_blocks;
create policy deal_pricing_memo_blocks_none on public.deal_pricing_memo_blocks
for all using (false) with check (false);
