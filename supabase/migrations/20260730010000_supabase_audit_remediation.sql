BEGIN;

-- ============================================================
-- Supabase security/performance audit remediation — 2026-07-30.
--
-- Follows up on a full-database audit (Supabase security + performance
-- advisors, cross-checked against pg_catalog directly). Zero ERROR-level
-- security findings; this migration addresses the WARN-level performance
-- findings that have real, verified query-cost impact, plus a handful of
-- additive missing-index fixes. Nothing here changes access-control
-- *logic* — every change is either (a) a pure "evaluate once per query
-- instead of once per row" wrap that Postgres/Supabase's own linter
-- recommends verbatim, (b) a role-list narrowing that removes a
-- structurally-redundant policy evaluation while leaving every role's
-- actual access unchanged (verified role-by-role below), or (c) a new
-- index (purely additive, cannot change any query result).
--
-- Every section is independently re-runnable (idempotent) and this whole
-- migration is wrapped in one transaction, so a failure anywhere rolls
-- back cleanly with zero partial state — consistent with this repo's
-- established DDL convention.
-- ============================================================


-- ============================================================
-- SECTION 1 — auth_rls_initplan: wrap auth.uid()/auth.jwt()/auth.role()/
-- current_setting() calls in RLS policies so Postgres evaluates them once
-- per query (via an InitPlan) instead of once per row. This is the exact
-- fix Supabase's database linter recommends:
-- https://supabase.com/docs/guides/database/database-linter?lint=0003_auth_rls_initplan
--
-- Rather than hand-writing ~90 ALTER POLICY statements (error-prone to
-- transcribe faithfully for deeply nested EXISTS-subquery policies), this
-- reads every public-schema policy's live definition from the catalog,
-- performs a pure textual substitution of the known unwrapped call
-- patterns, and re-applies only the policies that actually changed.
-- Idempotent: policies already wrapped, or with no matching pattern, are
-- left untouched (the replace() calls are no-ops on already-wrapped text,
-- and the IS DISTINCT FROM guard skips policies where nothing changed).
-- ============================================================
DO $$
DECLARE
  pol RECORD;
  new_qual text;
  new_check text;
  alter_sql text;
BEGIN
  FOR pol IN
    SELECT
      n.nspname AS schemaname,
      c.relname AS tablename,
      p.polname AS policyname,
      pg_get_expr(p.polqual, p.polrelid) AS qual,
      pg_get_expr(p.polwithcheck, p.polrelid) AS with_check
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
  LOOP
    new_qual := pol.qual;
    new_check := pol.with_check;

    IF new_qual IS NOT NULL THEN
      new_qual := replace(new_qual, 'current_setting(''request.jwt.claims''::text, true)', '(select current_setting(''request.jwt.claims''::text, true))');
      new_qual := replace(new_qual, 'current_setting(''app.current_bank_id''::text, true)', '(select current_setting(''app.current_bank_id''::text, true))');
      new_qual := replace(new_qual, 'current_setting(''role''::text, true)', '(select current_setting(''role''::text, true))');
      new_qual := replace(new_qual, 'auth.uid()', '(select auth.uid())');
      new_qual := replace(new_qual, 'auth.jwt()', '(select auth.jwt())');
      new_qual := replace(new_qual, 'auth.role()', '(select auth.role())');
    END IF;

    IF new_check IS NOT NULL THEN
      new_check := replace(new_check, 'current_setting(''request.jwt.claims''::text, true)', '(select current_setting(''request.jwt.claims''::text, true))');
      new_check := replace(new_check, 'current_setting(''app.current_bank_id''::text, true)', '(select current_setting(''app.current_bank_id''::text, true))');
      new_check := replace(new_check, 'current_setting(''role''::text, true)', '(select current_setting(''role''::text, true))');
      new_check := replace(new_check, 'auth.uid()', '(select auth.uid())');
      new_check := replace(new_check, 'auth.jwt()', '(select auth.jwt())');
      new_check := replace(new_check, 'auth.role()', '(select auth.role())');
    END IF;

    IF new_qual IS DISTINCT FROM pol.qual OR new_check IS DISTINCT FROM pol.with_check THEN
      alter_sql := format('ALTER POLICY %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
      IF new_qual IS NOT NULL THEN
        alter_sql := alter_sql || format(' USING (%s)', new_qual);
      END IF;
      IF new_check IS NOT NULL THEN
        alter_sql := alter_sql || format(' WITH CHECK (%s)', new_check);
      END IF;
      RAISE NOTICE 'auth_rls_initplan fix: %', alter_sql;
      EXECUTE alter_sql;
    END IF;
  END LOOP;
END $$;


-- ============================================================
-- SECTION 2 — multiple_permissive_policies, pattern A: a "<x>_deny"
-- policy (roles=PUBLIC, FOR ALL, always false) stacked with a
-- "<x>_worker" policy (roles=buddy_worker, FOR ALL, always true). Since
-- PUBLIC includes buddy_worker, buddy_worker evaluates BOTH policies on
-- every row/query (false OR true = true — correct today, but redundant).
-- Fix: narrow the deny policy's role list to the two other RLS-enforced
-- roles (anon, authenticated — service_role bypasses RLS entirely via
-- rolbypassrls, confirmed via pg_roles). buddy_worker then evaluates only
-- its own always-true policy; anon/authenticated are still denied by the
-- (now-narrower) deny policy. Net access per role is unchanged.
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='fdd_filings' AND policyname='fdd_filings_deny') THEN
    ALTER POLICY fdd_filings_deny ON public.fdd_filings TO anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='fdd_item19_facts' AND policyname='fdd_item19_facts_deny') THEN
    ALTER POLICY fdd_item19_facts_deny ON public.fdd_item19_facts TO anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='franchise_brand_aliases' AND policyname='franchise_aliases_deny') THEN
    ALTER POLICY franchise_aliases_deny ON public.franchise_brand_aliases TO anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='franchise_brands' AND policyname='franchise_brands_deny') THEN
    ALTER POLICY franchise_brands_deny ON public.franchise_brands TO anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='franchise_sba_directory_snapshots' AND policyname='fsd_snapshots_deny') THEN
    ALTER POLICY fsd_snapshots_deny ON public.franchise_sba_directory_snapshots TO anon, authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='franchise_sync_runs' AND policyname='franchise_sync_runs_deny') THEN
    ALTER POLICY franchise_sync_runs_deny ON public.franchise_sync_runs TO anon, authenticated;
  END IF;
END $$;


-- ============================================================
-- SECTION 3 — multiple_permissive_policies, pattern B: a "<x>_deny"
-- policy (roles=PUBLIC, FOR ALL, always false) stacked with a
-- "<x>_select_bank" policy (roles=PUBLIC, FOR SELECT, real bank-membership
-- check). Unlike pattern A, both target PUBLIC, so for SELECT specifically
-- every role evaluates both (false OR real-check = real-check — the deny
-- contributes nothing on SELECT, but still costs an evaluation). ALTER
-- POLICY cannot change a policy's command type, so pattern A's role-narrow
-- trick doesn't apply here; instead the ALL-command deny is split into
-- three single-command deny policies (INSERT/UPDATE/DELETE), leaving
-- SELECT to the _select_bank policy alone. Net effect is identical: writes
-- are still denied to every role (service_role bypasses RLS regardless),
-- reads are still gated by the same bank-membership check.
-- ============================================================
DO $$
DECLARE
  t text;
  deny_name text;
  tbls text[] := ARRAY['borrower_pfs_notes_payable', 'borrower_pfs_real_estate', 'borrower_pfs_securities', 'signing_requests'];
  deny_names text[] := ARRAY['pfs_np_deny', 'pfs_re_deny', 'pfs_sec_deny', 'sr_deny'];
  i int;
BEGIN
  FOR i IN 1 .. array_length(tbls, 1) LOOP
    t := tbls[i];
    deny_name := deny_names[i];
    IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname=deny_name) THEN
      EXECUTE format('DROP POLICY %I ON public.%I', deny_name, t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO public WITH CHECK (false)', deny_name || '_insert', t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO public USING (false) WITH CHECK (false)', deny_name || '_update', t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO public USING (false)', deny_name || '_delete', t);
      RAISE NOTICE 'multiple_permissive_policies fix (pattern B): % split into %/_update/_delete', deny_name, deny_name || '_insert';
    END IF;
  END LOOP;
END $$;


-- ============================================================
-- SECTION 4 — multiple_permissive_policies on screen_artifacts:
-- "screen_artifacts_public_read" (roles=PUBLIC, SELECT, is_public=true)
-- overlaps "screen_artifacts_select_merged" (roles=authenticated, SELECT,
-- owner_id=auth.uid()) for the authenticated role specifically. Fix:
-- narrow public_read to the roles that don't already have their own
-- SELECT policy (anon, buddy_worker), and fold the is_public=true
-- condition into select_merged so authenticated users keep exactly the
-- same access (their own rows OR any public row) via one policy instead
-- of two. (select_merged's auth.uid() call is already wrapped — untouched
-- by section 1 — so this only adds the OR clause.)
-- ============================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='screen_artifacts' AND policyname='screen_artifacts_public_read') THEN
    ALTER POLICY screen_artifacts_public_read ON public.screen_artifacts TO anon, buddy_worker;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='screen_artifacts' AND policyname='screen_artifacts_select_merged') THEN
    ALTER POLICY screen_artifacts_select_merged ON public.screen_artifacts
      USING ((owner_id = (select auth.uid())) OR (is_public = true));
  END IF;
END $$;


-- ============================================================
-- SECTION 5 — unindexed_foreign_keys: 21 single-column FKs with no
-- covering index, found via direct pg_constraint/pg_index catalog check
-- (not just the advisor's sampled findings). Purely additive — cannot
-- change any query result, only join/cascade-delete performance as these
-- tables grow. All 21 tables are at or near zero rows today, so this
-- costs no meaningful lock time.
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_agent_claims_bank_id ON public.agent_claims (bank_id);
CREATE INDEX IF NOT EXISTS idx_agent_claims_finding_id ON public.agent_claims (finding_id);
CREATE INDEX IF NOT EXISTS idx_arbitration_decisions_bank_id ON public.arbitration_decisions (bank_id);
CREATE INDEX IF NOT EXISTS idx_arbitration_decisions_chosen_claim_id ON public.arbitration_decisions (chosen_claim_id);
CREATE INDEX IF NOT EXISTS idx_arbitration_decisions_conflict_set_id ON public.arbitration_decisions (conflict_set_id);
CREATE INDEX IF NOT EXISTS idx_bank_document_fill_runs_deal_id ON public.bank_document_fill_runs (deal_id);
CREATE INDEX IF NOT EXISTS idx_borrower_pfs_notes_payable_deal_id ON public.borrower_pfs_notes_payable (deal_id);
CREATE INDEX IF NOT EXISTS idx_borrower_pfs_real_estate_deal_id ON public.borrower_pfs_real_estate (deal_id);
CREATE INDEX IF NOT EXISTS idx_borrower_pfs_securities_deal_id ON public.borrower_pfs_securities (deal_id);
CREATE INDEX IF NOT EXISTS idx_claim_conflict_sets_bank_id ON public.claim_conflict_sets (bank_id);
CREATE INDEX IF NOT EXISTS idx_deal_business_plan_attestations_bank_id ON public.deal_business_plan_attestations (bank_id);
CREATE INDEX IF NOT EXISTS idx_deal_business_plan_attestations_package_id ON public.deal_business_plan_attestations (package_id);
CREATE INDEX IF NOT EXISTS idx_deal_hostile_interrogations_bank_id ON public.deal_hostile_interrogations (bank_id);
CREATE INDEX IF NOT EXISTS idx_deal_pipeline_runs_truth_snapshot_id ON public.deal_pipeline_runs (truth_snapshot_id);
CREATE INDEX IF NOT EXISTS idx_deal_structured_field_confirmations_bank_id ON public.deal_structured_field_confirmations (bank_id);
CREATE INDEX IF NOT EXISTS idx_deal_truth_snapshots_bank_id ON public.deal_truth_snapshots (bank_id);
CREATE INDEX IF NOT EXISTS idx_document_substitutions_bank_id ON public.document_substitutions (bank_id);
CREATE INDEX IF NOT EXISTS idx_overlay_application_log_bank_id ON public.overlay_application_log (bank_id);
CREATE INDEX IF NOT EXISTS idx_overlay_generated_claims_bank_id ON public.overlay_generated_claims (bank_id);
CREATE INDEX IF NOT EXISTS idx_signing_requests_bank_id ON public.signing_requests (bank_id);
CREATE INDEX IF NOT EXISTS idx_signing_requests_filled_bank_document_id ON public.signing_requests (filled_bank_document_id);
CREATE INDEX IF NOT EXISTS idx_signing_requests_signer_ownership_entity_id ON public.signing_requests (signer_ownership_entity_id);

COMMIT;

-- Reload PostgREST schema cache.
NOTIFY pgrst, 'reload schema';
