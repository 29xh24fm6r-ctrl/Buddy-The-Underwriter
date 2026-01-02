-- ============================================================
-- CHECKLIST ↔ DOCS RECONCILIATION SYSTEM
-- 
-- Auto-marks checklist items as "received" when matching docs arrive
-- Works for both deal_documents and deal_files tables
-- ============================================================

-- ============================================================
-- 1) Trigger fn: when a doc has checklist_key -> mark item received
-- ============================================================

create or replace function public.fn_mark_checklist_received_from_doc()
returns trigger
language plpgsql
security definer
as $$
begin
  -- Only act when we have a checklist_key and deal_id
  if new.deal_id is null or new.checklist_key is null or length(trim(new.checklist_key)) = 0 then
    return new;
  end if;

  update public.deal_checklist_items
  set
    received_at = coalesce(received_at, now()),
    received_document_id = coalesce(received_document_id, new.id),
    status = case
      when status is null then 'received'
      when status in ('missing','requested','pending') then 'received'
      else status
    end,
    updated_at = now()
  where deal_id = new.deal_id
    and checklist_key = new.checklist_key;

  return new;
end;
$$;

drop trigger if exists trg_mark_checklist_received_from_doc on public.deal_documents;

create trigger trg_mark_checklist_received_from_doc
after insert or update of checklist_key on public.deal_documents
for each row
execute function public.fn_mark_checklist_received_from_doc();


-- ============================================================
-- 2) Optional: same behavior for deal_files (if you rely on deal_files)
-- ============================================================

create or replace function public.fn_mark_checklist_received_from_file()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.deal_id is null or new.checklist_key is null or length(trim(new.checklist_key)) = 0 then
    return new;
  end if;

  update public.deal_checklist_items
  set
    received_at = coalesce(received_at, now()),
    received_file_id = coalesce(received_file_id, new.id),
    status = case
      when status is null then 'received'
      when status in ('missing','requested','pending') then 'received'
      else status
    end,
    updated_at = now()
  where deal_id = new.deal_id
    and checklist_key = new.checklist_key;

  return new;
end;
$$;

drop trigger if exists trg_mark_checklist_received_from_file on public.deal_files;

create trigger trg_mark_checklist_received_from_file
after insert or update of checklist_key on public.deal_files
for each row
execute function public.fn_mark_checklist_received_from_file();


-- ============================================================
-- 3) Add received_document_id and received_file_id columns if missing
-- ============================================================

do $$
begin
  if not exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' 
    and table_name = 'deal_checklist_items' 
    and column_name = 'received_document_id'
  ) then
    alter table public.deal_checklist_items 
    add column received_document_id uuid references public.deal_documents(id) on delete set null;
  end if;

  if not exists (
    select 1 from information_schema.columns 
    where table_schema = 'public' 
    and table_name = 'deal_checklist_items' 
    and column_name = 'received_file_id'
  ) then
    alter table public.deal_checklist_items 
    add column received_file_id uuid references public.deal_files(id) on delete set null;
  end if;
end $$;


-- ============================================================
-- 4) Backfill existing uploads (one-time reconciliation)
-- ============================================================

-- Mark checklist items as received if matching docs exist
update public.deal_checklist_items ci
set
  received_at = coalesce(ci.received_at, now()),
  status = case
    when ci.status is null then 'received'
    when ci.status in ('missing','requested','pending') then 'received'
    else ci.status
  end,
  updated_at = now()
where ci.received_at is null
  and exists (
    select 1 from public.deal_documents d
    where d.deal_id = ci.deal_id
      and d.checklist_key = ci.checklist_key
  );

-- Same for deal_files
update public.deal_checklist_items ci
set
  received_at = coalesce(ci.received_at, now()),
  status = case
    when ci.status is null then 'received'
    when ci.status in ('missing','requested','pending') then 'received'
    else ci.status
  end,
  updated_at = now()
where ci.received_at is null
  and exists (
    select 1 from public.deal_files f
    where f.deal_id = ci.deal_id
      and f.checklist_key = ci.checklist_key
  );
