-- Generated forms remain private; the existing authenticated server routes
-- upload and issue short-lived download URLs after checking deal access.
insert into storage.buckets (id, name, public, allowed_mime_types)
values ('bank-forms', 'bank-forms', false, array['application/pdf'])
on conflict (id) do nothing;

-- The existing bundle owns every delivered artifact. No second package table.
alter table public.buddy_trident_bundles
  add column if not exists credit_memo_pdf_path text,
  add column if not exists spreads_pdf_path text,
  add column if not exists sba_forms_pdf_path text;
