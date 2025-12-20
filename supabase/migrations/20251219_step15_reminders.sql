-- 20251219_step15_reminders.sql

begin;

create table if not exists public.deal_reminder_subscriptions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  created_at timestamptz not null default now(),

  channel text not null check (channel in ('email','sms')),
  destination text not null, -- email address or phone
  enabled boolean not null default true,

  -- cadence
  cadence_days int not null default 3,
  last_sent_at timestamptz null,

  -- optional: only remind when deal is still active
  stop_after timestamptz null
);

create index if not exists deal_reminder_subscriptions_deal_id_idx
  on public.deal_reminder_subscriptions(deal_id);

create table if not exists public.deal_reminder_events (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  created_at timestamptz not null default now(),

  channel text not null check (channel in ('email','sms')),
  destination text not null,

  -- what we sent (keys only)
  missing_keys text[] not null,

  -- result
  status text not null default 'queued' check (status in ('queued','sent','failed')),
  error text null
);

create index if not exists deal_reminder_events_deal_id_idx on public.deal_reminder_events(deal_id);

commit;
