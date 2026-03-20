-- ================================================
-- MIGRATION: borrower portal end-to-end
-- ================================================

-- 1) Checklist items: ensure required columns exist
alter table public.deal_checklist_items
  add column if not exists description text,
  add column if not exists checklist_key text,
  add column if not exists required boolean default true,
  add column if not exists received_at timestamptz,
  add column if not exists received_upload_id uuid;

-- Make sure checklist_key exists and is indexed
create index if not exists deal_checklist_items_deal_id_idx
  on public.deal_checklist_items(deal_id);

create index if not exists deal_checklist_items_key_idx
  on public.deal_checklist_items(deal_id, checklist_key);

-- 2) Borrower portal links: token -> deal
create table if not exists public.borrower_portal_links (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  token text not null unique,
  label text,
  single_use boolean not null default true,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

create index if not exists borrower_portal_links_deal_id_idx
  on public.borrower_portal_links(deal_id);

-- 3) Uploads: each file
create table if not exists public.uploads (
  id uuid primary key default gen_random_uuid(),
  original_filename text not null,
  mime_type text,
  bytes bigint,
  storage_bucket text not null default 'uploads',
  storage_path text not null,
  sha256 text,
  created_by text, -- clerk user id (underwriter) OR 'borrower:<token>'
  created_at timestamptz not null default now()
);

create index if not exists uploads_created_at_idx
  on public.uploads(created_at desc);

-- 4) Deal uploads: attach to deal, assign checklist_key, track status
create type if not exists public.deal_upload_status as enum ('uploaded','classified','extracting','extracted','needs_review','confirmed','rejected');

create table if not exists public.deal_uploads (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  upload_id uuid not null references public.uploads(id) on delete cascade,
  checklist_key text,
  doc_type text,
  status public.deal_upload_status not null default 'uploaded',
  confidence numeric,
  page_count int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists deal_uploads_unique
  on public.deal_uploads(deal_id, upload_id);

create index if not exists deal_uploads_deal_id_idx
  on public.deal_uploads(deal_id);

create index if not exists deal_uploads_checklist_idx
  on public.deal_uploads(deal_id, checklist_key);

-- 5) Extraction record (per upload)
create type if not exists public.extraction_status as enum ('queued','running','extracted','failed');

create table if not exists public.doc_extractions (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references public.uploads(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  status public.extraction_status not null default 'queued',
  confidence numeric,
  extracted_json jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists doc_extractions_unique
  on public.doc_extractions(deal_id, upload_id);

-- 6) Normalized extracted fields + review state
create table if not exists public.doc_fields (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  upload_id uuid not null references public.uploads(id) on delete cascade,
  field_key text not null,
  field_label text not null,
  field_value text not null,
  needs_attention boolean not null default false,
  confirmed boolean not null default false,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists doc_fields_deal_upload_idx
  on public.doc_fields(deal_id, upload_id);

create index if not exists doc_fields_attention_idx
  on public.doc_fields(deal_id, upload_id, needs_attention, confirmed);

-- 7) Borrower confirmation submissions (document-level)
create type if not exists public.doc_submission_status as enum ('submitted','accepted','rejected');

create table if not exists public.doc_submissions (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  upload_id uuid not null references public.uploads(id) on delete cascade,
  token text not null, -- borrower portal token for audit
  status public.doc_submission_status not null default 'submitted',
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists doc_submissions_deal_id_idx
  on public.doc_submissions(deal_id);

-- 8) Deal events (append-only) for pipeline triggers & audit
create table if not exists public.deal_events (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  kind text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists deal_events_deal_id_idx
  on public.deal_events(deal_id, created_at desc);

-- 9) updated_at triggers for tables that need it
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists deal_uploads_set_updated_at on public.deal_uploads;
create trigger deal_uploads_set_updated_at
before update on public.deal_uploads
for each row execute function public.set_updated_at();

drop trigger if exists doc_extractions_set_updated_at on public.doc_extractions;
create trigger doc_extractions_set_updated_at
before update on public.doc_extractions
for each row execute function public.set_updated_at();

drop trigger if exists doc_fields_set_updated_at on public.doc_fields;
create trigger doc_fields_set_updated_at
before update on public.doc_fields
for each row execute function public.set_updated_at();

-- 10) When doc submission happens -> mark deal_upload confirmed, mark checklist received, emit pipeline event
create or replace function public.on_doc_submitted()
returns trigger language plpgsql as $$
declare
  v_checklist_key text;
begin
  -- mark deal_upload confirmed
  update public.deal_uploads
     set status = 'confirmed'
   where deal_id = new.deal_id
     and upload_id = new.upload_id;

  -- if linked to checklist, mark received
  select checklist_key into v_checklist_key
    from public.deal_uploads
   where deal_id = new.deal_id
     and upload_id = new.upload_id
   limit 1;

  if v_checklist_key is not null then
    update public.deal_checklist_items
       set received_at = now(),
           received_upload_id = new.upload_id
     where deal_id = new.deal_id
       and checklist_key = v_checklist_key;
  end if;

  -- emit deal event: doc_confirmed
  insert into public.deal_events(deal_id, kind, payload)
  values (new.deal_id, 'doc_confirmed', jsonb_build_object('upload_id', new.upload_id, 'checklist_key', v_checklist_key));

  return new;
end; $$;

drop trigger if exists doc_submissions_on_insert on public.doc_submissions;
create trigger doc_submissions_on_insert
after insert on public.doc_submissions
for each row execute function public.on_doc_submitted();
