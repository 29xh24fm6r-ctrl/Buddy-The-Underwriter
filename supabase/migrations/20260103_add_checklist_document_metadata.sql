-- Add missing document metadata columns used by checklist read ordering.
alter table public.deal_checklist_items
  add column if not exists document_category text;

alter table public.deal_checklist_items
  add column if not exists document_label text;

-- Backfill label for existing rows
update public.deal_checklist_items
set document_label = checklist_key
where document_label is null;
