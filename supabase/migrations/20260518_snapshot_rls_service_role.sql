-- SPEC-BANKER-FLOW-FIX-BATCH-1 Fix 8: RLS service_role policies
CREATE POLICY IF NOT EXISTS "service_role_all" ON public.financial_snapshots
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "service_role_all" ON public.financial_snapshot_decisions
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "service_role_all" ON public.borrowers
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "service_role_all" ON public.marketplace_claims
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
