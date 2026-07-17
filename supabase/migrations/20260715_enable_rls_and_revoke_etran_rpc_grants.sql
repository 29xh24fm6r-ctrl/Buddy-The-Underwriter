-- Security hardening per Supabase advisor findings from the borrower-flow
-- audit (2026-07-15). All app-code access to these tables/RPCs goes
-- exclusively through the service-role client (supabaseAdmin()), verified
-- by repo-wide grep before this migration — so RLS-enabled-with-no-policy
-- (deny-by-default for anon/authenticated) and revoking anon/authenticated
-- EXECUTE cannot break any legitimate app functionality; they only close
-- direct-API-call exposure to holders of the public anon key.

-- 1) RLS was fully disabled on 8 tables, making them readable/writable by
-- anyone with the anon key over the REST API.
ALTER TABLE public.crm_organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lender_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lender_invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lender_invoice_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_session_events ENABLE ROW LEVEL SECURITY;

-- 2) etran_get_credentials_decrypted / etran_upsert_credentials
-- (SECURITY DEFINER — decrypt/write lender E-Tran client-cert + private
-- key material) were EXECUTE-granted to anon and authenticated, meaning
-- anyone with the public anon key could call them directly over
-- /rest/v1/rpc/... The app's own encryption-key argument was the only
-- barrier at that point, not an auth/role check. Revoke both grants;
-- service_role (what the app actually uses) and postgres are untouched.
REVOKE EXECUTE ON FUNCTION public.etran_get_credentials_decrypted FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.etran_upsert_credentials FROM anon, authenticated;
