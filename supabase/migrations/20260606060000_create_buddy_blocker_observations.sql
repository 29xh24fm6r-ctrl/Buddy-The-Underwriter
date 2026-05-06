-- SPEC-10: persistent blocker observations.
--
-- Tracks first_seen / last_seen / seen_count / resolved_at for each
-- blocker code on a deal. Drives the `stale_blocker` behavior pattern in
-- the cockpit advisor — without it, "blocker present > 24h" can't fire
-- across sessions.
--
-- The observations API degrades gracefully when this table is missing.

create table if not exists buddy_blocker_observations (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null,
  deal_id uuid not null,
  blocker_key text not null,
  blocker_kind text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  seen_count integer not null default 1,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bank_id, deal_id, blocker_key)
);

create index if not exists idx_buddy_blocker_observations_deal
  on buddy_blocker_observations (bank_id, deal_id);

create index if not exists idx_buddy_blocker_observations_unresolved
  on buddy_blocker_observations (bank_id, deal_id)
  where resolved_at is null;

comment on table buddy_blocker_observations is
  'SPEC-10: tracks first/last_seen and seen_count per blocker for the cockpit advisor.';
