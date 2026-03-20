-- Two-Phase Naming: add display_name + naming metadata to deal_documents and deals.
-- Documents get a provisional name (original_filename) at upload, then a derived name
-- after classification/OCR provides doc_type, year, entity_name.
-- Deals get a derived name once an anchor document (BTR/PFS/etc.) is classified.

-- ─── 1. deal_documents: display_name + naming metadata ──────────────────────

ALTER TABLE public.deal_documents
  ADD COLUMN IF NOT EXISTS display_name        TEXT,
  ADD COLUMN IF NOT EXISTS naming_method       TEXT,      -- 'provisional' | 'derived' | 'manual'
  ADD COLUMN IF NOT EXISTS naming_source       TEXT,      -- 'filename' | 'classification' | 'ocr' | 'user'
  ADD COLUMN IF NOT EXISTS naming_confidence   NUMERIC,
  ADD COLUMN IF NOT EXISTS naming_fallback_reason TEXT,
  ADD COLUMN IF NOT EXISTS named_at            TIMESTAMPTZ;

-- Backfill: set provisional display_name from original_filename where missing
UPDATE public.deal_documents
SET display_name     = original_filename,
    naming_method    = 'provisional',
    naming_source    = 'filename',
    named_at         = created_at
WHERE display_name IS NULL
  AND original_filename IS NOT NULL;

-- ─── 2. deals: naming metadata (display_name already exists) ────────────────

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS naming_method          TEXT,   -- 'provisional' | 'derived' | 'manual'
  ADD COLUMN IF NOT EXISTS naming_source          TEXT,   -- 'filename' | 'classification' | 'ocr' | 'user' | 'doc_extraction'
  ADD COLUMN IF NOT EXISTS naming_fallback_reason TEXT,
  ADD COLUMN IF NOT EXISTS named_at               TIMESTAMPTZ;

-- ─── 3. Update list_deal_documents RPC to include display_name + doc_type ───

CREATE OR REPLACE FUNCTION public.list_deal_documents(p_deal_id uuid)
RETURNS TABLE (
  id                  uuid,
  deal_id             uuid,
  storage_bucket      text,
  storage_path        text,
  original_filename   text,
  display_name        text,
  document_type       text,
  doc_year            integer,
  entity_name         text,
  naming_method       text,
  mime_type           text,
  size_bytes          bigint,
  uploader_user_id    uuid,
  uploaded_via_link_id uuid,
  source              text,
  checklist_key       text,
  sha256              text,
  created_at          timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.deal_id,
    d.storage_bucket,
    d.storage_path,
    d.original_filename,
    d.display_name,
    d.document_type,
    d.doc_year,
    d.entity_name,
    d.naming_method,
    d.mime_type,
    d.size_bytes,
    d.uploader_user_id,
    d.uploaded_via_link_id,
    d.source,
    d.checklist_key,
    d.sha256,
    d.created_at
  FROM public.deal_documents d
  WHERE d.deal_id = p_deal_id
  ORDER BY d.created_at DESC;
END;
$$;
