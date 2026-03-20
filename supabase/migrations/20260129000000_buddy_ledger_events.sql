-- Buddy Ledger Events (forwarded from deal_pipeline_ledger via Pulse forwarder)
--
-- Stores redacted pipeline events forwarded from Buddy.
-- Schema matches PulseEvent { source, env, deal_id, bank_id, event_key, created_at, trace_id, payload }.
-- trace_id = ledger row ID; UNIQUE constraint enforces idempotent writes.

create table if not exists public.buddy_ledger_events (
  id uuid primary key default gen_random_uuid(),
  ingested_at timestamptz not null default now(),

  source text not null default 'buddy',
  env text not null,

  deal_id text not null,
  bank_id text null,
  event_key text not null,

  event_created_at timestamptz not null, -- original ledger timestamp from Buddy
  trace_id text not null unique,         -- ledger row ID; idempotency key

  payload jsonb not null default '{}'::jsonb
);

create index if not exists buddy_ledger_events_deal_id_idx
  on public.buddy_ledger_events (deal_id, ingested_at desc);

create index if not exists buddy_ledger_events_event_key_idx
  on public.buddy_ledger_events (event_key, ingested_at desc);

create index if not exists buddy_ledger_events_env_idx
  on public.buddy_ledger_events (env, ingested_at desc);

-- RLS: deny all direct access (service role bypasses RLS)
alter table public.buddy_ledger_events enable row level security;

drop policy if exists "deny_all" on public.buddy_ledger_events;
create policy "deny_all" on public.buddy_ledger_events for all using (false);
