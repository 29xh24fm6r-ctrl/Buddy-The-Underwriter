-- Backfill tracked migration history for five tables in the document intake
-- engine that are live in production but have no corresponding CREATE TABLE
-- migration anywhere in this repo (same drift class as
-- 20260710_brk_billing_lender_invoices.sql and
-- 20260710_backfill_deals_referral_bank_memberships_created_at.sql).
--
-- Discovered during an audit of the intake engine: deal_document_slots and
-- deal_document_slot_attachments are the heaviest tables in the slot-binding
-- flow (src/lib/intake/slots/*), deal_doc_chunks backs artifact text-chunk
-- storage (src/lib/artifacts/processArtifact.ts), deal_intake_scenario backs
-- the intake scenario endpoints, and document_extracts backs the smart-router
-- extraction pipeline. Because none had a migration, a fresh environment
-- provisioned purely from `supabase/migrations/` would be missing all five,
-- and `scripts/schema/gate-select-columns.mjs` silently skipped validating
-- any `.select()` against them (they weren't in schema-baseline.json either).
--
-- CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS make this a no-op
-- against the current production database (verified directly against
-- information_schema.columns, pg_constraint, and pg_indexes — column set,
-- constraints, and indexes here match prod exactly) while bringing fresh
-- environments in line with prod.

create table if not exists deal_document_slots (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  bank_id uuid not null references banks(id) on delete cascade,
  slot_key text not null,
  slot_group text not null,
  required boolean not null default true,
  required_doc_type text not null,
  required_tax_year int,
  owner_id uuid,
  owner_display_name text,
  status text not null default 'empty',
  validation_reason text,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  slot_mode text not null default 'UPLOAD',
  interactive_kind text,
  help_title text,
  help_reason text,
  help_examples jsonb,
  help_alternatives jsonb,
  required_entity_id uuid,
  required_entity_role text,
  constraint deal_document_slots_deal_id_slot_key_key unique (deal_id, slot_key)
);

create index if not exists idx_deal_document_slots_deal on deal_document_slots (deal_id);
create index if not exists idx_deal_document_slots_group on deal_document_slots (deal_id, slot_group);
create index if not exists idx_slots_entity on deal_document_slots (deal_id, required_entity_role, required_entity_id);

comment on table deal_document_slots is
  'Document intake: required/optional checklist slots a deal must fill, one row per slot_key.';

create table if not exists deal_document_slot_attachments (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  bank_id uuid not null references banks(id) on delete cascade,
  slot_id uuid not null references deal_document_slots(id) on delete cascade,
  document_id uuid not null references deal_documents(id) on delete cascade,
  attached_by_role text not null,
  attached_by_user_id text,
  is_active boolean not null default true,
  replaced_by_id uuid references deal_document_slot_attachments(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_slot_attachments_doc on deal_document_slot_attachments (document_id);
create index if not exists idx_slot_attachments_slot on deal_document_slot_attachments (slot_id, is_active);

comment on table deal_document_slot_attachments is
  'Document intake: links an uploaded deal_documents row to the deal_document_slots slot it satisfies.';

create table if not exists deal_doc_chunks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  deal_id uuid not null,
  upload_id uuid not null,
  original_filename text,
  storage_bucket text,
  storage_path text,
  chunk_index int not null,
  page_start int,
  page_end int,
  content text not null,
  embedding vector(1536),
  source_label text,
  constraint deal_doc_chunks_upload_id_chunk_index_key unique (upload_id, chunk_index)
);

create index if not exists deal_doc_chunks_deal_id_idx on deal_doc_chunks (deal_id);
create index if not exists deal_doc_chunks_embedding_ivfflat_idx
  on deal_doc_chunks using ivfflat (embedding vector_cosine_ops) with (lists = '100');

comment on table deal_doc_chunks is
  'Document intake: chunked + embedded text extracted from uploaded artifacts, used for RAG-style retrieval.';

create table if not exists deal_intake_scenario (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references deals(id) on delete cascade,
  bank_id uuid not null,
  product_type text not null,
  borrower_business_stage text not null default 'EXISTING',
  has_business_tax_returns boolean not null default true,
  has_financial_statements boolean not null default true,
  has_projections boolean not null default false,
  entity_age_months int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint deal_intake_scenario_deal_id_key unique (deal_id)
);

comment on table deal_intake_scenario is
  'Document intake: one row per deal describing the borrower/product scenario used to derive the required checklist slot set.';

create table if not exists document_extracts (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  attachment_id uuid not null,
  provider text not null default 'smart_router',
  status text not null default 'QUEUED',
  fields_json jsonb default '{}'::jsonb,
  tables_json jsonb default '[]'::jsonb,
  evidence_json jsonb default '[]'::jsonb,
  provider_metrics jsonb default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_extracts_attachment_id_unique unique (attachment_id)
);

create index if not exists idx_document_extracts_attachment_status on document_extracts (attachment_id, status);
create index if not exists idx_document_extracts_deal_id on document_extracts (deal_id);

comment on table document_extracts is
  'Document intake: smart-router structured-extraction results (fields/tables/evidence) for a deal_document_slot_attachments row.';
