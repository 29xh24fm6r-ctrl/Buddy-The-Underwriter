-- Fix list_deal_documents RPC to match production deal_documents schema.
-- Previous version referenced columns that may not exist (schema drift),
-- causing Postgres errors and empty UI states.
--
-- This RPC only returns columns that are guaranteed to exist based on
-- migrations applied to deal_documents table.

-- Drop the existing function first since we're changing the return type
DROP FUNCTION IF EXISTS public.list_deal_documents(uuid);

CREATE OR REPLACE FUNCTION public.list_deal_documents(p_deal_id uuid)
RETURNS TABLE (
  id uuid,
  deal_id uuid,
  storage_bucket text,
  storage_path text,
  original_filename text,
  display_name text,
  document_type text,
  doc_year integer,
  naming_method text,
  mime_type text,
  size_bytes bigint,
  source text,
  checklist_key text,
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
      d.display_name,
      d.document_type,
      d.doc_year,
      d.naming_method,
      d.mime_type,
      d.size_bytes,
      d.source,
      d.checklist_key,
      d.created_at
    FROM public.deal_documents d
    WHERE d.deal_id = p_deal_id
    ORDER BY d.created_at DESC;
END;
$$;
