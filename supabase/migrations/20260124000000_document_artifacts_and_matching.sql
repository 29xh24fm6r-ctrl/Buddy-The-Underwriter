-- =========================================================
-- Magic Intake + Classification System
-- Phase 0: document_artifacts + checklist_item_matches
-- =========================================================

begin;

-- =========================================================
-- 1) document_artifacts — machine understanding per uploaded file
--    One row per file in deal_documents OR borrower_uploads
-- =========================================================

create table if not exists public.document_artifacts (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null,

  -- Polymorphic source: which table + id
  source_table text not null check (source_table in ('deal_documents', 'borrower_uploads')),
  source_id uuid not null,

  -- Processing pipeline status
  status text not null default 'queued' check (status in (
    'queued',        -- waiting to be processed
    'processing',    -- AI classification in progress
    'classified',    -- doc_type determined
    'extracted',     -- fields extracted (optional step)
    'matched',       -- matched to checklist items
    'failed'         -- processing error
  )),
  error_message text null,
  retry_count int not null default 0,

  -- Classification results
  doc_type text null,  -- IRS_BUSINESS, IRS_PERSONAL, PFS, RENT_ROLL, T12, BANK_STATEMENT, etc.
  doc_type_confidence numeric null check (doc_type_confidence is null or (doc_type_confidence >= 0 and doc_type_confidence <= 1)),
  doc_type_reason text null,

  -- Extracted metadata
  tax_year int null,                     -- e.g. 2023
  entity_name text null,                 -- business or individual name from doc
  entity_type text null,                 -- 'business' | 'personal'
  period_start date null,                -- for T12/rent rolls
  period_end date null,

  -- Raw extraction data (full AI response)
  extraction_json jsonb null,

  -- Checklist matching
  matched_checklist_key text null,       -- The key it matched (e.g. IRS_BUSINESS_2Y)
  match_confidence numeric null check (match_confidence is null or (match_confidence >= 0 and match_confidence <= 1)),
  match_reason text null,

  -- Deal name proposal (for BTR/PTR docs)
  proposed_deal_name text null,
  proposed_deal_name_source text null,   -- 'schedule_c' | 'form_1120' | 'k1' etc.

  -- Audit
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz null,
  classified_at timestamptz null,
  matched_at timestamptz null,

  -- Ensure one artifact per source document
  unique(source_table, source_id)
);

-- Indexes for common queries
create index if not exists idx_document_artifacts_deal_id on public.document_artifacts(deal_id);
create index if not exists idx_document_artifacts_bank_id on public.document_artifacts(bank_id);
create index if not exists idx_document_artifacts_status on public.document_artifacts(status);
create index if not exists idx_document_artifacts_doc_type on public.document_artifacts(doc_type);
create index if not exists idx_document_artifacts_source on public.document_artifacts(source_table, source_id);
create index if not exists idx_document_artifacts_queued on public.document_artifacts(status, created_at)
  where status = 'queued';
create index if not exists idx_document_artifacts_processing on public.document_artifacts(status, updated_at)
  where status = 'processing';

-- =========================================================
-- 2) checklist_item_matches — junction table linking artifacts to checklist items
--    Allows M:N matching (one doc could match multiple checklist items)
-- =========================================================

create table if not exists public.checklist_item_matches (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null,

  -- The artifact (source document)
  artifact_id uuid not null references public.document_artifacts(id) on delete cascade,

  -- The checklist item it satisfies (may or may not exist yet)
  checklist_item_id uuid null references public.deal_checklist_items(id) on delete set null,
  checklist_key text not null,  -- Always store the key even if item not yet created

  -- Match quality
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  reason text null,
  match_source text null,  -- 'ai_classification' | 'manual' | 'filename_heuristic'

  -- Year matching (for multi-year requirements)
  tax_year int null,

  -- Status
  status text not null default 'proposed' check (status in (
    'proposed',    -- AI suggested this match
    'confirmed',   -- User confirmed the match
    'rejected',    -- User rejected the match
    'auto_applied' -- High confidence auto-accepted
  )),

  -- Audit
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_by text null,
  confirmed_at timestamptz null,

  -- Prevent duplicate matches
  unique(artifact_id, checklist_key, tax_year)
);

-- Indexes
create index if not exists idx_checklist_item_matches_deal_id on public.checklist_item_matches(deal_id);
create index if not exists idx_checklist_item_matches_artifact_id on public.checklist_item_matches(artifact_id);
create index if not exists idx_checklist_item_matches_checklist_item_id on public.checklist_item_matches(checklist_item_id);
create index if not exists idx_checklist_item_matches_checklist_key on public.checklist_item_matches(checklist_key);
create index if not exists idx_checklist_item_matches_status on public.checklist_item_matches(status);
create index if not exists idx_checklist_item_matches_proposed on public.checklist_item_matches(deal_id, status)
  where status = 'proposed';

-- =========================================================
-- 3) Update triggers for updated_at
-- =========================================================

create or replace function public.trg_document_artifacts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists document_artifacts_updated_at on public.document_artifacts;
create trigger document_artifacts_updated_at
before update on public.document_artifacts
for each row execute function public.trg_document_artifacts_updated_at();

create or replace function public.trg_checklist_item_matches_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists checklist_item_matches_updated_at on public.checklist_item_matches;
create trigger checklist_item_matches_updated_at
before update on public.checklist_item_matches
for each row execute function public.trg_checklist_item_matches_updated_at();

-- =========================================================
-- 4) RPC: Queue artifact for processing
-- =========================================================

create or replace function public.queue_document_artifact(
  p_deal_id uuid,
  p_bank_id uuid,
  p_source_table text,
  p_source_id uuid
) returns uuid
language plpgsql
security definer
as $$
declare
  v_artifact_id uuid;
begin
  insert into public.document_artifacts (
    deal_id,
    bank_id,
    source_table,
    source_id,
    status
  )
  values (
    p_deal_id,
    p_bank_id,
    p_source_table,
    p_source_id,
    'queued'
  )
  on conflict (source_table, source_id)
  do update set
    status = case
      when document_artifacts.status = 'failed' then 'queued'
      else document_artifacts.status
    end,
    retry_count = case
      when document_artifacts.status = 'failed' then document_artifacts.retry_count + 1
      else document_artifacts.retry_count
    end,
    updated_at = now()
  returning id into v_artifact_id;

  return v_artifact_id;
end;
$$;

-- =========================================================
-- 5) RPC: Get next artifact to process (for worker)
-- =========================================================

create or replace function public.claim_next_artifact_for_processing()
returns table (
  id uuid,
  deal_id uuid,
  bank_id uuid,
  source_table text,
  source_id uuid,
  retry_count int
)
language plpgsql
security definer
as $$
declare
  v_artifact_id uuid;
begin
  -- Use FOR UPDATE SKIP LOCKED to avoid contention
  select a.id into v_artifact_id
  from public.document_artifacts a
  where a.status = 'queued'
  order by a.created_at
  limit 1
  for update skip locked;

  if v_artifact_id is null then
    return;
  end if;

  -- Mark as processing
  update public.document_artifacts a
  set
    status = 'processing',
    processed_at = now(),
    updated_at = now()
  where a.id = v_artifact_id;

  -- Return the artifact
  return query
  select
    a.id,
    a.deal_id,
    a.bank_id,
    a.source_table,
    a.source_id,
    a.retry_count
  from public.document_artifacts a
  where a.id = v_artifact_id;
end;
$$;

-- =========================================================
-- 6) RPC: Update artifact with classification results
-- =========================================================

create or replace function public.update_artifact_classification(
  p_artifact_id uuid,
  p_doc_type text,
  p_doc_type_confidence numeric,
  p_doc_type_reason text,
  p_tax_year int,
  p_entity_name text,
  p_entity_type text,
  p_extraction_json jsonb default null,
  p_proposed_deal_name text default null,
  p_proposed_deal_name_source text default null
) returns void
language plpgsql
security definer
as $$
begin
  update public.document_artifacts
  set
    status = 'classified',
    doc_type = p_doc_type,
    doc_type_confidence = p_doc_type_confidence,
    doc_type_reason = p_doc_type_reason,
    tax_year = p_tax_year,
    entity_name = p_entity_name,
    entity_type = p_entity_type,
    extraction_json = p_extraction_json,
    proposed_deal_name = p_proposed_deal_name,
    proposed_deal_name_source = p_proposed_deal_name_source,
    classified_at = now(),
    updated_at = now()
  where id = p_artifact_id;
end;
$$;

-- =========================================================
-- 7) RPC: Mark artifact as matched with checklist
-- =========================================================

create or replace function public.update_artifact_matched(
  p_artifact_id uuid,
  p_matched_checklist_key text,
  p_match_confidence numeric,
  p_match_reason text
) returns void
language plpgsql
security definer
as $$
begin
  update public.document_artifacts
  set
    status = 'matched',
    matched_checklist_key = p_matched_checklist_key,
    match_confidence = p_match_confidence,
    match_reason = p_match_reason,
    matched_at = now(),
    updated_at = now()
  where id = p_artifact_id;
end;
$$;

-- =========================================================
-- 8) RPC: Mark artifact as failed
-- =========================================================

create or replace function public.mark_artifact_failed(
  p_artifact_id uuid,
  p_error_message text
) returns void
language plpgsql
security definer
as $$
begin
  update public.document_artifacts
  set
    status = 'failed',
    error_message = p_error_message,
    updated_at = now()
  where id = p_artifact_id;
end;
$$;

-- =========================================================
-- 9) RPC: Create checklist match
-- =========================================================

create or replace function public.create_checklist_match(
  p_deal_id uuid,
  p_bank_id uuid,
  p_artifact_id uuid,
  p_checklist_key text,
  p_confidence numeric,
  p_reason text,
  p_match_source text,
  p_tax_year int default null,
  p_auto_apply boolean default false
) returns uuid
language plpgsql
security definer
as $$
declare
  v_match_id uuid;
  v_checklist_item_id uuid;
  v_status text;
begin
  -- Find corresponding checklist item if it exists
  select id into v_checklist_item_id
  from public.deal_checklist_items
  where deal_id = p_deal_id and checklist_key = p_checklist_key
  limit 1;

  -- Determine status based on confidence and auto_apply flag
  if p_auto_apply and p_confidence >= 0.85 then
    v_status := 'auto_applied';
  else
    v_status := 'proposed';
  end if;

  insert into public.checklist_item_matches (
    deal_id,
    bank_id,
    artifact_id,
    checklist_item_id,
    checklist_key,
    confidence,
    reason,
    match_source,
    tax_year,
    status
  )
  values (
    p_deal_id,
    p_bank_id,
    p_artifact_id,
    v_checklist_item_id,
    p_checklist_key,
    p_confidence,
    p_reason,
    p_match_source,
    p_tax_year,
    v_status
  )
  on conflict (artifact_id, checklist_key, tax_year)
  do update set
    confidence = excluded.confidence,
    reason = excluded.reason,
    updated_at = now()
  returning id into v_match_id;

  return v_match_id;
end;
$$;

-- =========================================================
-- 10) RPC: Get artifacts summary for a deal (for UI)
-- =========================================================

create or replace function public.get_deal_artifacts_summary(p_deal_id uuid)
returns table (
  total_files bigint,
  queued bigint,
  processing bigint,
  classified bigint,
  matched bigint,
  failed bigint,
  proposed_matches bigint,
  auto_applied_matches bigint,
  confirmed_matches bigint
)
language plpgsql
security definer
as $$
begin
  return query
  select
    count(*)::bigint as total_files,
    count(*) filter (where a.status = 'queued')::bigint as queued,
    count(*) filter (where a.status = 'processing')::bigint as processing,
    count(*) filter (where a.status = 'classified')::bigint as classified,
    count(*) filter (where a.status = 'matched')::bigint as matched,
    count(*) filter (where a.status = 'failed')::bigint as failed,
    (select count(*) from public.checklist_item_matches m where m.deal_id = p_deal_id and m.status = 'proposed')::bigint as proposed_matches,
    (select count(*) from public.checklist_item_matches m where m.deal_id = p_deal_id and m.status = 'auto_applied')::bigint as auto_applied_matches,
    (select count(*) from public.checklist_item_matches m where m.deal_id = p_deal_id and m.status = 'confirmed')::bigint as confirmed_matches
  from public.document_artifacts a
  where a.deal_id = p_deal_id;
end;
$$;

-- =========================================================
-- 11) Revoke public access to internal functions
-- =========================================================

revoke all on function public.queue_document_artifact(uuid, uuid, text, uuid) from public;
revoke all on function public.claim_next_artifact_for_processing() from public;
revoke all on function public.update_artifact_classification(uuid, text, numeric, text, int, text, text, jsonb, text, text) from public;
revoke all on function public.update_artifact_matched(uuid, text, numeric, text) from public;
revoke all on function public.mark_artifact_failed(uuid, text) from public;
revoke all on function public.create_checklist_match(uuid, uuid, uuid, text, numeric, text, text, int, boolean) from public;

commit;
