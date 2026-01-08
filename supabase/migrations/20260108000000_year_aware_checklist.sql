-- Year-aware checklist + robust doc stamping fields

alter table public.deal_checklist_items
  add column if not exists required_years int[] null,
  add column if not exists satisfied_years int[] null;

alter table public.deal_documents
  add column if not exists doc_year int null,
  add column if not exists doc_years int[] null,
  add column if not exists document_type text null,
  add column if not exists match_confidence real null,
  add column if not exists match_reason text null;

-- Optional: indexes for performance
create index if not exists idx_deal_docs_deal_checklist_key
  on public.deal_documents (deal_id, checklist_key);

create index if not exists idx_deal_docs_deal_doc_year
  on public.deal_documents (deal_id, doc_year);
