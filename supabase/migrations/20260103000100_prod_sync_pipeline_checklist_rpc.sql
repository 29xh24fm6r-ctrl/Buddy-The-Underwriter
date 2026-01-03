-- PR E: Production schema sync (idempotent)
-- Fixes:
-- 1) pipeline/latest expects new UI-ready columns on deal_pipeline_ledger
-- 2) files/list expects public.list_deal_documents RPC to exist

-- 1) Ensure pipeline UI columns exist
ALTER TABLE public.deal_pipeline_ledger
  ADD COLUMN IF NOT EXISTS event_key text;

ALTER TABLE public.deal_pipeline_ledger
  ADD COLUMN IF NOT EXISTS ui_state text;

ALTER TABLE public.deal_pipeline_ledger
  ADD COLUMN IF NOT EXISTS ui_message text;

ALTER TABLE public.deal_pipeline_ledger
  ADD COLUMN IF NOT EXISTS meta jsonb;

-- Backfill event_key from legacy stage if needed
UPDATE public.deal_pipeline_ledger
SET event_key = stage
WHERE event_key IS NULL;

-- 2) Ensure list_deal_documents RPC exists (SECURITY DEFINER bypasses RLS)
CREATE OR REPLACE FUNCTION public.list_deal_documents(p_deal_id uuid)
RETURNS TABLE (
  id uuid,
  deal_id uuid,
  storage_bucket text,
  storage_path text,
  original_filename text,
  mime_type text,
  size_bytes bigint,
  uploader_user_id uuid,
  uploaded_via_link_id uuid,
  source text,
  checklist_key text,
  sha256 text,
  created_at timestamptz
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
