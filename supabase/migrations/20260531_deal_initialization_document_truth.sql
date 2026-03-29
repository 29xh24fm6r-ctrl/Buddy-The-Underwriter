-- Deal Initialization & Document Truth Architecture
-- Canonical document ledger + deal initialization hardening

-- ─── Canonical Document Ledger ────────────────────────────────────────────────
-- Single source of truth for all document state on a deal.
-- All UI panels must read from this table only.
create table if not exists public.deal_document_items (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  document_id uuid null,
  requirement_code text not null,
  requirement_group text null,
  canonical_doc_type text null,
  year integer null,
  party_scope text null,
  subject_id uuid null,
  uploaded_at timestamptz null,
  classified_at timestamptz null,
  classified_type text null,
  confidence numeric null,
  review_status text not null default 'unreviewed',
  validation_status text not null default 'pending',
  checklist_status text not null default 'missing',
  readiness_status text not null default 'blocking',
  finalized_at timestamptz null,
  source_file_name text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint deal_document_items_review_ck check (
    review_status in ('unreviewed','confirmed','rejected')
  ),
  constraint deal_document_items_validation_ck check (
    validation_status in ('pending','valid','invalid')
  ),
  constraint deal_document_items_checklist_ck check (
    checklist_status in ('missing','received','satisfied','waived')
  ),
  constraint deal_document_items_readiness_ck check (
    readiness_status in ('blocking','warning','complete','optional')
  )
);

alter table public.deal_document_items enable row level security;

create policy "bank_scoped_deal_document_items" on public.deal_document_items
  using (
    deal_id in (
      select id from deals where bank_id = (
        select bank_id from bank_users where user_id = auth.uid() limit 1
      )
    )
  );

create index if not exists idx_deal_document_items_deal
  on public.deal_document_items (deal_id, requirement_code);
create index if not exists idx_deal_document_items_document
  on public.deal_document_items (document_id) where document_id is not null;
create index if not exists idx_deal_document_items_status
  on public.deal_document_items (deal_id, checklist_status, readiness_status);

-- ─── Document State Snapshots ─────────────────────────────────────────────────
-- Cached recompute output consumed by all UI panels.
create table if not exists public.deal_document_snapshots (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,

  requirement_state jsonb not null default '{}'::jsonb,
  readiness jsonb not null default '{}'::jsonb,
  blockers jsonb not null default '[]'::jsonb,

  computed_at timestamptz not null default now()
);

alter table public.deal_document_snapshots enable row level security;

create policy "bank_scoped_deal_document_snapshots" on public.deal_document_snapshots
  using (
    deal_id in (
      select id from deals where bank_id = (
        select bank_id from bank_users where user_id = auth.uid() limit 1
      )
    )
  );

create unique index if not exists uq_deal_document_snapshots_deal
  on public.deal_document_snapshots (deal_id);

-- ─── Deal audit log (if not exists) ──────────────────────────────────────────
create table if not exists public.deal_audit_log (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null references public.banks(id) on delete cascade,
  actor_id uuid null,
  event text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.deal_audit_log enable row level security;

create policy "bank_scoped_deal_audit_log" on public.deal_audit_log
  using (bank_id = (select bank_id from bank_users where user_id = auth.uid() limit 1));

create index if not exists idx_deal_audit_log_deal
  on public.deal_audit_log (deal_id, created_at desc);
