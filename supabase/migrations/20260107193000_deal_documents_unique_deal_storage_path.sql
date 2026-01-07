-- Ensure banker/public/borrower upload commits can upsert idempotently.
-- Upsert conflict target: (deal_id, storage_path)

create unique index if not exists deal_documents_deal_id_storage_path_uniq
on public.deal_documents (deal_id, storage_path);
