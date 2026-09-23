-- Supabase defaults can grant EXECUTE directly to anon/authenticated.
-- Revoking PUBLIC alone does not remove these role-specific grants.
REVOKE ALL ON FUNCTION public.ensure_borrower_doc_extraction_handoff(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_borrower_doc_extraction_handoff(uuid, uuid, uuid) TO service_role;
