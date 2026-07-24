-- The INSERT policies below are named as if they restrict writes to the
-- service role ("Service role can insert shadow log", "*_insert_service"),
-- but they were created with the default `TO public` role list combined
-- with `WITH CHECK (true)` -- in Postgres RLS, `public` means "every role",
-- including anon and authenticated via PostgREST. So any caller with any
-- valid Supabase API key (even the anon key) could INSERT arbitrary rows
-- into these shadow/reconciliation log tables. The application only ever
-- writes to them via the service-role client (which bypasses RLS
-- entirely), so scoping these policies to `service_role` closes the gap
-- with zero behavior change for the app.

alter policy "Service role can insert shadow log"
  on public.classification_shadow_log
  to service_role;

alter policy "deal_reconciliation_findings_insert_service"
  on public.deal_reconciliation_findings
  to service_role;

alter policy "ocr_shadow_insert_service"
  on public.ocr_shadow_comparisons
  to service_role;
