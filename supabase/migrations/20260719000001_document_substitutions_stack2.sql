-- document_substitutions: audit log of documents auto-satisfied by a
-- connected Plaid bank-account link or a completed IRS transcript request.
--
-- The original 20251227000006_connect_accounts.sql migration that first
-- defined this table is recorded as applied in
-- supabase_migrations.schema_migrations, but none of its objects (this
-- table, borrower_account_connections, connected_account_data) actually
-- exist live — a known, already-tracked drift (see
-- specs/schema-drift/SD-C-first-report-2026-04-27.json). This migration
-- recreates document_substitutions only, retargeted at the real Stack-2
-- tables (borrower_bank_connections, borrower_irs_transcript_requests) —
-- it deliberately does NOT recreate borrower_account_connections /
-- connected_account_data, which fed the confirmed-dead Stack-1 Plaid/
-- QuickBooks/IRS integration in src/lib/connect/{plaid,quickbooks,irs}.ts.

create table if not exists public.document_substitutions (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,

  bank_connection_id uuid null references public.borrower_bank_connections(id) on delete cascade,
  irs_request_id uuid null references public.borrower_irs_transcript_requests(id) on delete cascade,

  original_doc_requirement text not null,
  substituted_by text not null check (substituted_by in ('plaid_bank', 'irs_transcript')),
  substitution_conditions jsonb null,

  readiness_boost numeric(5,2) null,
  docs_saved integer null,
  auto_approved boolean not null default true,

  created_at timestamptz not null default now(),

  constraint document_substitutions_source_check
    check (bank_connection_id is not null or irs_request_id is not null),
  unique (deal_id, original_doc_requirement, substituted_by)
);

create index if not exists idx_doc_substitutions_deal
  on public.document_substitutions (deal_id);
create index if not exists idx_doc_substitutions_bank_connection
  on public.document_substitutions (bank_connection_id);
create index if not exists idx_doc_substitutions_irs_request
  on public.document_substitutions (irs_request_id);

alter table public.document_substitutions enable row level security;
create policy deny_all_document_substitutions on public.document_substitutions for all using (false);
