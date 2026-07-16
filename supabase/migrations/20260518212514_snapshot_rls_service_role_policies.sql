-- Reconstructed from live schema (supabase_migrations.schema_migrations) --
-- applied directly to the production project and never committed to the
-- repo. Captured verbatim for governance/reproducibility (see CRM audit,
-- 2026-07-16).

-- SPEC-BANKER-FLOW-FIX-BATCH-1 Fix 8: RLS policies for snapshot tables
CREATE POLICY "service_role_all" ON public.financial_snapshots
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all" ON public.financial_snapshot_decisions
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all" ON public.borrowers
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all" ON public.marketplace_claims
  AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true);
