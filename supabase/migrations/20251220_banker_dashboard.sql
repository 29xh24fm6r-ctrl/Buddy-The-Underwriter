-- 20251220_banker_dashboard.sql
-- Master Banker Control Panel support: status history + KPI facts + predictions cache

begin;

-- 1) Deal status history (auditable, enables stage aging + churn + accurate close metrics)
create table if not exists public.deal_status_history (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  changed_by_user_id uuid null,
  from_stage text null,
  to_stage text not null,
  note text null,
  meta_json jsonb null,
  changed_at timestamptz not null default now()
);

create index if not exists idx_deal_status_history_deal_id on public.deal_status_history(deal_id);
create index if not exists idx_deal_status_history_changed_at on public.deal_status_history(changed_at);
create index if not exists idx_deal_status_history_to_stage on public.deal_status_history(to_stage);

-- 2) Deal predictions cache (rules-based initially; later can store model outputs)
create table if not exists public.deal_predictions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null unique,
  probability numeric(5,2) not null default 50.00 check (probability >= 0 and probability <= 100),
  eta_close_date date null,
  risk_flags jsonb not null default '[]'::jsonb,
  reasons jsonb not null default '[]'::jsonb,
  computed_at timestamptz not null default now(),
  model_version text not null default 'rules_v1'
);

create index if not exists idx_deal_predictions_probability on public.deal_predictions(probability);
create index if not exists idx_deal_predictions_eta_close_date on public.deal_predictions(eta_close_date);

-- 3) Dashboard KPI snapshots (optional but nice for speed; can be computed on the fly too)
create table if not exists public.dashboard_kpi_snapshots (
  id uuid primary key default gen_random_uuid(),
  scope text not null default 'global', -- 'global' or 'user:<uuid>'
  range_key text not null, -- 'mtd','qtd','ytd','last_30','custom'
  start_date date not null,
  end_date date not null,
  kpis jsonb not null,
  computed_at timestamptz not null default now(),
  unique(scope, range_key, start_date, end_date)
);

create index if not exists idx_dashboard_kpi_snapshots_scope on public.dashboard_kpi_snapshots(scope);
create index if not exists idx_dashboard_kpi_snapshots_computed_at on public.dashboard_kpi_snapshots(computed_at);

-- RLS: lock down; serve via service role API routes
alter table public.deal_status_history enable row level security;
alter table public.deal_predictions enable row level security;
alter table public.dashboard_kpi_snapshots enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='deal_status_history' and policyname='deny_all_deal_status_history') then
    create policy deny_all_deal_status_history on public.deal_status_history for all using (false) with check (false);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='deal_predictions' and policyname='deny_all_deal_predictions') then
    create policy deny_all_deal_predictions on public.deal_predictions for all using (false) with check (false);
  end if;

  if not exists (select 1 from pg_policies where schemaname='public' and tablename='dashboard_kpi_snapshots' and policyname='deny_all_dashboard_kpi_snapshots') then
    create policy deny_all_dashboard_kpi_snapshots on public.dashboard_kpi_snapshots for all using (false) with check (false);
  end if;
end $$;

commit;
