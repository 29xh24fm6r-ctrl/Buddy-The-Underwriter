-- Phase 65F — Borrower Orchestration Layer
-- Campaigns, request items, events, and reminder scheduling
-- Tied to canonical_action_executions from 65E

-- 1. Borrower request campaigns
create table if not exists public.borrower_request_campaigns (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null references public.banks(id) on delete cascade,
  canonical_execution_id uuid null references public.canonical_action_executions(id) on delete set null,
  action_code text not null,
  status text not null check (
    status in ('draft','queued','sent','in_progress','completed','expired','cancelled')
  ),
  borrower_name text null,
  borrower_phone text null,
  borrower_email text null,
  portal_link_id uuid null references public.borrower_portal_links(id) on delete set null,
  last_sent_at timestamptz null,
  completed_at timestamptz null,
  created_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_brc_deal_id on public.borrower_request_campaigns(deal_id);
create index if not exists idx_brc_status on public.borrower_request_campaigns(status);
create index if not exists idx_brc_exec_id on public.borrower_request_campaigns(canonical_execution_id);

alter table public.borrower_request_campaigns enable row level security;
create policy "service_role_full_access_brc" on public.borrower_request_campaigns
  for all using (true) with check (true);

-- 2. Borrower request items
create table if not exists public.borrower_request_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.borrower_request_campaigns(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  checklist_key text null,
  blocker_code text null,
  item_code text not null,
  title text not null,
  description text not null,
  required boolean not null default true,
  evidence_type text not null check (
    evidence_type in ('document_upload','document_submit','field_confirmation','form_completion','manual_review')
  ),
  status text not null check (
    status in ('pending','sent','viewed','uploaded','submitted','confirmed','completed','waived')
  ),
  due_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists idx_bri_campaign_id on public.borrower_request_items(campaign_id);
create index if not exists idx_bri_deal_id on public.borrower_request_items(deal_id);
create index if not exists idx_bri_status on public.borrower_request_items(status);

alter table public.borrower_request_items enable row level security;
create policy "service_role_full_access_bri" on public.borrower_request_items
  for all using (true) with check (true);

-- 3. Borrower request events (audit trail)
create table if not exists public.borrower_request_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.borrower_request_campaigns(id) on delete cascade,
  item_id uuid null references public.borrower_request_items(id) on delete set null,
  deal_id uuid not null references public.deals(id) on delete cascade,
  event_key text not null,
  channel text null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_bre_campaign_id on public.borrower_request_events(campaign_id);
create index if not exists idx_bre_deal_id on public.borrower_request_events(deal_id);

alter table public.borrower_request_events enable row level security;
create policy "service_role_full_access_bre" on public.borrower_request_events
  for all using (true) with check (true);

-- 4. Borrower reminder schedule
create table if not exists public.borrower_reminder_schedule (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.borrower_request_campaigns(id) on delete cascade,
  next_run_at timestamptz not null,
  cadence text not null check (
    cadence in ('24h','48h','72h','weekly','manual')
  ),
  is_active boolean not null default true,
  last_run_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists idx_brs_campaign_id on public.borrower_reminder_schedule(campaign_id);
create index if not exists idx_brs_next_run on public.borrower_reminder_schedule(next_run_at)
  where is_active = true;

alter table public.borrower_reminder_schedule enable row level security;
create policy "service_role_full_access_brs" on public.borrower_reminder_schedule
  for all using (true) with check (true);
