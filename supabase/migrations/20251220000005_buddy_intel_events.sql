create table if not exists public.buddy_intel_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- scope
  bank_id uuid null,
  deal_id uuid null,
  file_id uuid null,

  -- actor
  actor_user_id uuid null,
  actor_type text not null default 'system', -- 'system' | 'user' | 'borrower'

  -- event type + message
  event_type text not null, -- e.g. 'upload_received', 'ocr_complete', 'citation_opened', 'risk_flag', 'portal_step'
  severity text not null default 'info', -- 'info' | 'warn' | 'success' | 'danger'

  title text not null,
  message text null,

  -- optional evidence linkage
  citation_id uuid null,
  global_char_start integer null,
  global_char_end integer null,
  page integer null,

  -- ui metadata
  icon text null, -- emoji or icon key
  meta jsonb not null default '{}'::jsonb
);

create index if not exists buddy_intel_events_created_at_idx on public.buddy_intel_events (created_at desc);
create index if not exists buddy_intel_events_deal_id_idx on public.buddy_intel_events (deal_id);
create index if not exists buddy_intel_events_bank_id_idx on public.buddy_intel_events (bank_id);
create index if not exists buddy_intel_events_event_type_idx on public.buddy_intel_events (event_type);

-- RLS
alter table public.buddy_intel_events enable row level security;

-- Permissive read policy for authenticated users
-- TODO: Lock down to bank_members/deal_members before production
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='buddy_intel_events' and policyname='buddy_intel_events_read_authed'
  ) then
    create policy buddy_intel_events_read_authed
    on public.buddy_intel_events
    for select
    to authenticated
    using (true);
  end if;
end $$;
