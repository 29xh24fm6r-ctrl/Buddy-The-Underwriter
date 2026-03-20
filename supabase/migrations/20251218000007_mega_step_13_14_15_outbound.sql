-- MEGA 13/14/15: Borrower portal links + outbound send controls + audit (idempotent)

-- 1) Borrower portal link tokens (deep link into portal)
create table if not exists public.borrower_portal_links (
  id bigserial primary key,
  deal_id uuid not null,
  token text not null unique,
  label text,
  created_by text,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz
);

create index if not exists idx_borrower_portal_links_deal
  on public.borrower_portal_links (deal_id, created_at desc);

create index if not exists idx_borrower_portal_links_token
  on public.borrower_portal_links (token);

-- 2) Outbound settings (per deal) + safe defaults
create table if not exists public.deal_outbound_settings (
  deal_id uuid primary key,
  mode text not null default 'copy',           -- 'copy' | 'system'
  auto_send boolean not null default false,    -- MEGA 15 defaults OFF
  throttle_minutes int not null default 240,   -- 4 hours
  sla_minutes int not null default 60,         -- escalate/allow auto send only after SLA window (optional use)
  to_email text,                               -- borrower email (optional)
  from_email text,                             -- system from (optional)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3) Outbound send ledger (audit + throttle + dedupe)
create table if not exists public.deal_outbound_ledger (
  id bigserial primary key,
  deal_id uuid not null,
  kind text not null,                -- 'MISSING_DOCS_REQUEST'
  fingerprint text not null,         -- content hash
  to_email text not null,
  subject text not null,
  provider text not null default 'stub',
  provider_message_id text,
  status text not null default 'sent', -- sent|failed|skipped
  error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_deal_outbound_ledger_deal_kind_created
  on public.deal_outbound_ledger (deal_id, kind, created_at desc);

create index if not exists idx_deal_outbound_ledger_deal_kind_fingerprint
  on public.deal_outbound_ledger (deal_id, kind, fingerprint);

-- 4) Draft metadata (canonical draft per deal+kind)
alter table public.deal_message_drafts
  add column if not exists kind text,
  add column if not exists fingerprint text;

create index if not exists idx_deal_message_drafts_deal_kind
  on public.deal_message_drafts (deal_id, kind, status);

-- 5) Optional: add borrower_email to deals (if not already present)
alter table public.deals
  add column if not exists borrower_email text;
