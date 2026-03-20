-- 20251220_borrower_inbox_auto_attach_undo.sql
-- Auto-attach audit + 15-minute undo safety net

create table if not exists public.borrower_inbox_auto_attach_runs (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  bank_id uuid not null,
  threshold int not null default 85,
  created_at timestamptz not null default now()
);

create index if not exists borrower_inbox_auto_attach_runs_deal_id_idx
  on public.borrower_inbox_auto_attach_runs(deal_id, created_at desc);

create table if not exists public.borrower_inbox_auto_attach_run_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.borrower_inbox_auto_attach_runs(id) on delete cascade,
  deal_id uuid not null,
  bank_id uuid not null,

  upload_inbox_id uuid not null,
  request_id uuid not null,

  -- previous states (so we can revert)
  prev_inbox_status text,
  prev_matched_request_id uuid,
  prev_match_confidence int,
  prev_match_reason text,

  prev_request_status text,
  prev_received_storage_path text,
  prev_received_filename text,
  prev_received_mime text,
  prev_received_at timestamptz,
  prev_request_evidence jsonb,

  -- what we did
  new_inbox_status text,
  new_request_status text,

  ok boolean not null default true,
  error text,

  created_at timestamptz not null default now()
);

create index if not exists borrower_inbox_auto_attach_items_run_id_idx
  on public.borrower_inbox_auto_attach_run_items(run_id);

create index if not exists borrower_inbox_auto_attach_items_deal_id_idx
  on public.borrower_inbox_auto_attach_run_items(deal_id, created_at desc);

-- Optional: If you use RLS, either add policies or keep admin-only via service role.
-- This system is designed to be called from server routes using supabaseAdmin().
