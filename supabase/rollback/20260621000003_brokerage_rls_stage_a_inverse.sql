-- ============================================================================
-- Inverse of supabase/migrations/20260621000003_brokerage_rls_stage_a.sql.
--
-- NOT auto-applied. Run manually only if an emergency rollback is
-- required (e.g. an unforeseen caller path discovered to require non-
-- admin access).
-- ============================================================================

ALTER TABLE public.borrower_session_tokens DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_counters     DISABLE ROW LEVEL SECURITY;
