-- Production schema parity (idempotent)
-- Goal: prevent silent failures from schema drift (e.g., PGRST204 missing columns)
-- Safe to run multiple times.

begin;

-- ------------------------------------------------------------
-- borrower_upload_inbox: ensure auto-match fields exist
-- ------------------------------------------------------------
alter table public.borrower_upload_inbox
  add column if not exists hinted_doc_type text null;

alter table public.borrower_upload_inbox
  add column if not exists hinted_category text null;

alter table public.borrower_upload_inbox
  add column if not exists matched_request_id uuid null;

alter table public.borrower_upload_inbox
  add column if not exists match_confidence int null;

alter table public.borrower_upload_inbox
  add column if not exists match_reason text null;

alter table public.borrower_upload_inbox
  add column if not exists status text not null default 'unmatched';

-- Add FK for matched_request_id if missing
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'borrower_upload_inbox_matched_request_id_fkey'
  ) then
    alter table public.borrower_upload_inbox
      add constraint borrower_upload_inbox_matched_request_id_fkey
      foreign key (matched_request_id)
      references public.borrower_document_requests(id)
      on delete set null;
  end if;
end $$;

-- Add status check constraint if missing
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'borrower_upload_inbox_status_check'
  ) then
    alter table public.borrower_upload_inbox
      add constraint borrower_upload_inbox_status_check
      check (status in ('unmatched', 'attached', 'rejected'));
  end if;
end $$;

create index if not exists borrower_upload_inbox_deal_id_idx
  on public.borrower_upload_inbox(deal_id);

create index if not exists borrower_upload_inbox_status_idx
  on public.borrower_upload_inbox(status);

create index if not exists borrower_upload_inbox_matched_request_id_idx
  on public.borrower_upload_inbox(matched_request_id);

-- ------------------------------------------------------------
-- borrower_files: ensure categorization/verification fields exist
-- ------------------------------------------------------------
alter table public.borrower_files
  add column if not exists file_type text null;

alter table public.borrower_files
  add column if not exists doc_category text null;

alter table public.borrower_files
  add column if not exists verification_status text null;

commit;
