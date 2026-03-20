-- Durable outbox for Buddy → Pulse pipeline events.
-- Buddy writes rows; buddy-core-worker forwards them to Pulse MCP.
-- Worker uses claimed_at + claim_owner for lease-based concurrency.

create table if not exists public.buddy_outbox_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  kind text not null,
  deal_id uuid not null,
  bank_id uuid null,

  payload jsonb not null default '{}'::jsonb,

  delivered_at timestamptz null,
  attempts int not null default 0,
  last_error text null,

  claimed_at timestamptz null,
  claim_owner text null
);

create index if not exists buddy_outbox_events_ready_idx
  on public.buddy_outbox_events (delivered_at, claimed_at, created_at);

create index if not exists buddy_outbox_events_kind_idx
  on public.buddy_outbox_events (kind);

-- RLS: deny all direct access by default.
-- The buddy_worker role gets explicit access via 20260129_buddy_outbox_worker_role.sql.
-- service_role bypasses RLS (used by Buddy app for inserts via supabaseAdmin).
alter table public.buddy_outbox_events enable row level security;

drop policy if exists "deny_all" on public.buddy_outbox_events;
create policy "deny_all" on public.buddy_outbox_events for all using (false);
