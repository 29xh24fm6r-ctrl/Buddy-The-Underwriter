-- Phase 65K.5: Crypto Relationship Extension
-- Depends on: relationships table from 65K.1 (20260530_relationship_registry.sql)
-- All tables are bank-scoped, append-only events, RLS-enabled.

-- ---------------------------------------------------------------------------
-- 6.1 Crypto Collateral Positions
-- ---------------------------------------------------------------------------
create table if not exists public.relationship_crypto_collateral_positions (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null,
  bank_id uuid not null references public.banks(id) on delete cascade,
  deal_id uuid null references public.deals(id) on delete set null,

  asset_symbol text not null,
  custody_provider text null,
  custody_account_ref text null,

  pledged_units numeric not null,
  eligible_advance_rate numeric null,
  haircut_percent numeric null,

  market_value_usd numeric null,
  collateral_value_usd numeric null,
  secured_exposure_usd numeric null,
  current_ltv numeric null,

  warning_ltv_threshold numeric not null,
  margin_call_ltv_threshold numeric not null,
  liquidation_ltv_threshold numeric not null,

  custody_status text not null default 'unverified',
  valuation_status text not null default 'unavailable',
  position_status text not null default 'active',

  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint rel_crypto_positions_custody_ck check (
    custody_status in ('unverified','verified','transfer_pending','control_issue')
  ),
  constraint rel_crypto_positions_valuation_ck check (
    valuation_status in ('current','stale','unavailable')
  ),
  constraint rel_crypto_positions_status_ck check (
    position_status in ('active','released','liquidated','closed')
  )
);

alter table public.relationship_crypto_collateral_positions enable row level security;

create policy "bank_scoped_crypto_positions" on public.relationship_crypto_collateral_positions
  using (bank_id = (select bank_id from bank_users where user_id = auth.uid() limit 1));

create index if not exists idx_rel_crypto_positions_relationship
  on public.relationship_crypto_collateral_positions (relationship_id, updated_at desc);
create index if not exists idx_rel_crypto_positions_bank
  on public.relationship_crypto_collateral_positions (bank_id, updated_at desc);
create index if not exists idx_rel_crypto_positions_deal
  on public.relationship_crypto_collateral_positions (deal_id);
create index if not exists idx_rel_crypto_positions_status
  on public.relationship_crypto_collateral_positions (position_status, custody_status, valuation_status);

-- ---------------------------------------------------------------------------
-- 6.2 Crypto Price Snapshots (append-only)
-- ---------------------------------------------------------------------------
create table if not exists public.relationship_crypto_price_snapshots (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null,
  bank_id uuid not null references public.banks(id) on delete cascade,

  asset_symbol text not null,
  price_source text not null,
  reference_price_usd numeric not null,
  source_timestamp timestamptz not null,
  ingested_at timestamptz not null default now(),

  evidence jsonb not null default '{}'::jsonb
);

alter table public.relationship_crypto_price_snapshots enable row level security;

create policy "bank_scoped_crypto_price_snapshots" on public.relationship_crypto_price_snapshots
  using (bank_id = (select bank_id from bank_users where user_id = auth.uid() limit 1));

create index if not exists idx_rel_crypto_price_snapshots_lookup
  on public.relationship_crypto_price_snapshots (relationship_id, asset_symbol, ingested_at desc);
create index if not exists idx_rel_crypto_price_snapshots_bank
  on public.relationship_crypto_price_snapshots (bank_id, ingested_at desc);

-- ---------------------------------------------------------------------------
-- 6.3 Crypto Margin Events
-- ---------------------------------------------------------------------------
create table if not exists public.relationship_crypto_margin_events (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null,
  bank_id uuid not null references public.banks(id) on delete cascade,
  collateral_position_id uuid not null references public.relationship_crypto_collateral_positions(id) on delete cascade,

  event_type text not null,
  status text not null default 'open',

  ltv_at_event numeric null,
  threshold_at_event numeric null,

  cure_due_at timestamptz null,
  resolved_at timestamptz null,

  borrower_package_id uuid null,
  approval_required boolean not null default false,
  approval_status text not null default 'not_applicable',

  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint rel_crypto_margin_events_type_ck check (
    event_type in (
      'warning_triggered',
      'margin_call_opened',
      'cure_started',
      'cure_failed',
      'liquidation_review_opened',
      'liquidation_approved',
      'liquidation_declined',
      'liquidation_executed',
      'resolved'
    )
  ),
  constraint rel_crypto_margin_events_status_ck check (
    status in ('open','in_progress','resolved','cancelled','expired')
  ),
  constraint rel_crypto_margin_events_approval_ck check (
    approval_status in ('not_applicable','review_required','approved','declined','executed')
  )
);

alter table public.relationship_crypto_margin_events enable row level security;

create policy "bank_scoped_crypto_margin_events" on public.relationship_crypto_margin_events
  using (bank_id = (select bank_id from bank_users where user_id = auth.uid() limit 1));

create index if not exists idx_rel_crypto_margin_events_position
  on public.relationship_crypto_margin_events (collateral_position_id, created_at desc);
create index if not exists idx_rel_crypto_margin_events_relationship
  on public.relationship_crypto_margin_events (relationship_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- 6.4 Crypto Monitoring Programs
-- ---------------------------------------------------------------------------
create table if not exists public.relationship_crypto_monitoring_programs (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null,
  bank_id uuid not null references public.banks(id) on delete cascade,

  status text not null default 'active',
  cadence text not null default 'daily',
  trigger_mode text not null default 'threshold_proximity',
  last_evaluated_at timestamptz null,
  next_evaluate_at timestamptz null,

  config jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint rel_crypto_monitoring_status_ck check (
    status in ('active','paused','closed')
  ),
  constraint rel_crypto_monitoring_cadence_ck check (
    cadence in ('daily','12h','6h','1h','15m','manual')
  )
);

alter table public.relationship_crypto_monitoring_programs enable row level security;

create policy "bank_scoped_crypto_monitoring" on public.relationship_crypto_monitoring_programs
  using (bank_id = (select bank_id from bank_users where user_id = auth.uid() limit 1));

create index if not exists idx_rel_crypto_monitoring_relationship
  on public.relationship_crypto_monitoring_programs (relationship_id);

-- ---------------------------------------------------------------------------
-- 6.5 Crypto Protection Cases
-- ---------------------------------------------------------------------------
create table if not exists public.relationship_crypto_protection_cases (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null,
  bank_id uuid not null references public.banks(id) on delete cascade,
  margin_event_id uuid not null references public.relationship_crypto_margin_events(id) on delete cascade,

  status text not null default 'open',
  owner_user_id uuid null,

  banker_review_required boolean not null default true,
  banker_review_completed_at timestamptz null,
  banker_review_completed_by uuid null,

  outcome jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '{}'::jsonb,

  opened_at timestamptz not null default now(),
  resolved_at timestamptz null,
  closed_at timestamptz null,

  constraint rel_crypto_protection_cases_status_ck check (
    status in (
      'open',
      'banker_review_required',
      'ready',
      'borrower_cure_open',
      'in_progress',
      'resolved',
      'stalled',
      'closed'
    )
  )
);

-- Only one active case per margin event
create unique index if not exists uq_rel_crypto_active_case
  on public.relationship_crypto_protection_cases (margin_event_id)
  where closed_at is null;

alter table public.relationship_crypto_protection_cases enable row level security;

create policy "bank_scoped_crypto_protection_cases" on public.relationship_crypto_protection_cases
  using (bank_id = (select bank_id from bank_users where user_id = auth.uid() limit 1));

create index if not exists idx_rel_crypto_protection_cases_relationship
  on public.relationship_crypto_protection_cases (relationship_id, status);

-- ---------------------------------------------------------------------------
-- 6.6 Crypto Events (append-only ledger)
-- ---------------------------------------------------------------------------
create table if not exists public.relationship_crypto_events (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null,
  bank_id uuid not null references public.banks(id) on delete cascade,

  event_code text not null,
  actor_type text not null default 'system',
  actor_user_id uuid null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint rel_crypto_events_actor_type_ck check (
    actor_type in ('system','banker','borrower','cron','migration','custody_webhook')
  )
);

alter table public.relationship_crypto_events enable row level security;

create policy "bank_scoped_crypto_events" on public.relationship_crypto_events
  using (bank_id = (select bank_id from bank_users where user_id = auth.uid() limit 1));

create index if not exists idx_rel_crypto_events_relationship
  on public.relationship_crypto_events (relationship_id, created_at desc);
create index if not exists idx_rel_crypto_events_bank
  on public.relationship_crypto_events (bank_id, created_at desc);
create index if not exists idx_rel_crypto_events_code
  on public.relationship_crypto_events (event_code, created_at desc);
