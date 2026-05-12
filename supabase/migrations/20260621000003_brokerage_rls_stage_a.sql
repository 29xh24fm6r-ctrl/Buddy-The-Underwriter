-- ============================================================================
-- SPEC-BROKERAGE-LAUNCH-BLOCKERS-V1 §3.4 + §3.5 — RLS Stage A.
--
-- Enable RLS on the two brokerage-critical tables that today live with
-- RLS disabled in production. Add NO policies — service role
-- (`supabaseAdmin()`) is unaffected by RLS, anon access drops to zero.
--
-- Every existing caller already uses the admin client. The
-- `scripts/guards/guard-brokerage-rls-tables.mjs` CI guard locks that
-- invariant going forward.
--
-- Inverse migration co-located at
--   supabase/rollback/20260621000003_brokerage_rls_stage_a_inverse.sql
-- It is NOT auto-applied. Ops uses it only if an emergency rollback is
-- needed.
-- ============================================================================

ALTER TABLE public.borrower_session_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limit_counters     ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.borrower_session_tokens IS
  'Anonymous brokerage session records. Raw token lives ONLY in the buddy_borrower_session HTTP-only cookie. DB stores SHA-256 hash. Lookups hash the incoming cookie before comparing. 90-day expiry. RLS Stage A: enabled with NO policies — service role only.';

COMMENT ON TABLE public.rate_limit_counters IS
  'Rate-limit counter store (multi-tier IP / session windows). Service role only. RLS Stage A: enabled with NO policies.';
