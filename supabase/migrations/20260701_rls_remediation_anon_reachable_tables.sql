-- ============================================================================
-- SPEC-RLS-REMEDIATION-1
-- Enable RLS + tenant-scoped policies on 77 anon-reachable public base tables.
--
-- WHY: These tables carry credit-decision, session-token, pricing, and
-- financial tenant data but shipped with relrowsecurity=false and full
-- anon/authenticated DML grants — a GLBA multi-tenant isolation hole at the
-- database boundary. This migration closes that hole by mirroring the RLS
-- patterns already proven on ~161 sibling tables (see
-- 20260418_phase_84_rls_tenant_wall_batch_a.sql).
--
-- SAFETY / SCOPE:
--   * Migration-only. NO application-code change.
--   * `service_role` (rolbypassrls=true) bypasses RLS at the role level AND
--     gets an explicit ALL bypass policy per table (belt-and-suspenders,
--     mirrors Phase 84). All worker/admin access goes through supabaseAdmin()
--     (service_role), so enabling RLS is transparent to the app.
--   * §0.2 audit confirmed NO anon/authenticated Supabase client reads or
--     writes ANY of these 77 tables (all access is via service_role). The
--     `authenticated`-role tenant policies added here are therefore DORMANT
--     defense-in-depth (the app does not yet mint a `bank_id` JWT claim, same
--     as the Phase 84 disclosure) — they scope future RLS-client access.
--   * anon grants are intentionally LEFT INTACT (RLS is the surgical fix);
--     grant-hygiene revocation is a documented follow-on, not done here.
--   * Idempotent: ENABLE RLS is a no-op if already on; every policy is
--     DROP POLICY IF EXISTS then CREATE. Re-runnable.
--   * Wrapped in a single transaction — partial application cannot occur.
--
-- PATTERNS (verbatim from the proven Phase 84 tenant wall):
--   Pattern A (table has bank_id):      authenticated USING/CHECK
--     bank_id::text = jwt.claims->>'bank_id'
--   Pattern B (table has deal_id only): authenticated USING/CHECK
--     EXISTS (SELECT 1 FROM deals d WHERE d.id::text = <t>.deal_id::text
--             AND d.bank_id::text = jwt.claims->>'bank_id')
--     (This mirrors Phase 84's deal-scoped subquery. The spec references a
--      can_access_deal(deal_id) helper; that helper is not present in the
--      tracked migrations and could not be verified, so we use the repo's own
--      proven inline `deals` subquery — semantically identical tenant scope,
--      self-contained, no external-function dependency. If Matt confirms
--      can_access_deal() exists live and prefers it, the Pattern B body is a
--      one-line swap.)
--   Pattern C (no bank_id/deal_id): per-table disposition below.
--
-- NOTE ON COLUMN INTROSPECTION: ~40 of these tables are not defined in the
-- tracked repo migrations (their DDL lives only on the live DB), so their
-- exact key column could not be re-read here. Rather than hard-code a pattern
-- per table (a wrong column would abort the whole migration), the Tier-A/B
-- loop DETECTS bank_id vs deal_id from information_schema and applies the
-- matching pattern. Every table unconditionally gets ENABLE RLS +
-- service_role bypass first, so the anon/authenticated hole is closed even
-- for a table whose key column is a surprise (it is simply left with the
-- service_role-only policy = anon/authenticated fully denied).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- Tier A + Tier B — key-column-driven (Pattern A if bank_id, else Pattern B if
-- deal_id). Combined into one loop because the applied pattern is dictated by
-- the actual key column, not by the tier label. Both lists are kept explicit
-- for readability / intent.
-- ----------------------------------------------------------------------------
DO $rls$
DECLARE
  t         text;
  has_bank  boolean;
  has_deal  boolean;

  -- Tier A (spec: bank_id present -> Pattern A)
  tier_a text[] := ARRAY[
    'bank_loan_product_types','bank_match_hints','bank_policy_rules',
    'banker_focus_sessions','banker_queue_acknowledgements','banker_queue_snapshots',
    'borrower_session_tokens','buddy_feasibility_studies','builder_decisions',
    'checklist_item_matches','deal_annual_review_cases','deal_annual_reviews',
    'deal_monitoring_cycles','deal_monitoring_exceptions','deal_monitoring_obligations',
    'deal_monitoring_programs','deal_pricing_quotes','deal_renewal_cases',
    'deal_renewal_prep','deal_rent_roll_rows','deal_review_case_exceptions',
    'deal_review_case_outputs','deal_review_case_requirements','deal_spread_jobs',
    'deal_spread_runs','deal_watchlist_cases','deal_workout_cases',
    'financial_review_resolutions','pricing_decisions','pricing_scenarios',
    'rate_index_snapshots'
  ];

  -- Tier B (spec: deal_id present, no bank_id -> Pattern B)
  tier_b text[] := ARRAY[
    'buddy_borrower_reports','buddy_covenant_packages','buddy_guarantor_cashflow',
    'buddy_research_committee_task_reviews','buddy_research_committee_tasks',
    'buddy_research_quality_gates','buddy_research_source_artifacts',
    'buddy_research_source_snapshots','buddy_validation_reports',
    'deal_borrower_questions','deal_committee_decisions','deal_credit_memo_status',
    'deal_decision_finalization','deal_distribution_actions','deal_distribution_snapshots',
    'deal_entities','deal_flag_audit','deal_flag_send_packages','deal_flags',
    'deal_loan_decisions','deal_policy_exceptions','deal_pricing_inputs',
    'deal_structuring_freeze','deal_structuring_selections','deal_watchlist_events',
    'deal_workout_action_items','deal_workout_events','entity_relationships',
    'structuring_recommendation_snapshots'
  ];

  keyed text[] := tier_a || tier_b;
BEGIN
  FOREACH t IN ARRAY keyed LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      RAISE NOTICE 'RLS-REMEDIATION: table public.% not found on this DB — skipped (audit drift; investigate)', t;
      CONTINUE;
    END IF;

    -- (1) Close the hole unconditionally: RLS on + service_role bypass.
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;',
                   'rls_remediation_' || t || '_service_role', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);',
      'rls_remediation_' || t || '_service_role', t);

    -- (2) Dormant defense-in-depth tenant policy for `authenticated`,
    --     dictated by the actual key column.
    has_bank := EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = t AND column_name = 'bank_id');
    has_deal := EXISTS (SELECT 1 FROM information_schema.columns
                        WHERE table_schema = 'public' AND table_name = t AND column_name = 'deal_id');

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;',
                   'rls_remediation_' || t || '_tenant', t);

    IF has_bank THEN
      -- Pattern A
      EXECUTE format(
        $q$CREATE POLICY %I ON public.%I
             FOR ALL TO authenticated
             USING (bank_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'bank_id', ''))
             WITH CHECK (bank_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'bank_id', ''));$q$,
        'rls_remediation_' || t || '_tenant', t);
    ELSIF has_deal THEN
      -- Pattern B (inline deals subquery; ::text on both sides tolerates uuid or text deal_id)
      EXECUTE format(
        $q$CREATE POLICY %I ON public.%I
             FOR ALL TO authenticated
             USING (EXISTS (SELECT 1 FROM public.deals d
                            WHERE d.id::text = %I.deal_id::text
                              AND d.bank_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'bank_id', '')))
             WITH CHECK (EXISTS (SELECT 1 FROM public.deals d
                                 WHERE d.id::text = %I.deal_id::text
                                   AND d.bank_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'bank_id', '')));$q$,
        'rls_remediation_' || t || '_tenant', t, t, t);
    ELSE
      -- Neither key: hole is already closed by the service_role-only policy
      -- above (anon/authenticated are denied). Skip the tenant policy rather
      -- than guess a wrong isolation column.
      RAISE NOTICE 'RLS-REMEDIATION: public.% has neither bank_id nor deal_id; secured service_role-only, tenant policy skipped (reclassify as Tier C if intentional)', t;
    END IF;
  END LOOP;
END
$rls$;

-- ----------------------------------------------------------------------------
-- Tier C.1 — Global reference / read-only-safe.
-- authenticated may SELECT; writes are service_role-only (no write policy =>
-- authenticated INSERT/UPDATE/DELETE denied). anon has no policy => denied.
-- ----------------------------------------------------------------------------
DO $rls$
DECLARE
  t text;
  global_ref text[] := ARRAY[
    'loan_product_types','pricing_terms','buddy_industry_benchmarks',
    'platform_capabilities','buddy_ai_use_cases'
  ];
BEGIN
  FOREACH t IN ARRAY global_ref LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      RAISE NOTICE 'RLS-REMEDIATION: table public.% not found — skipped', t;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;',
                   'rls_remediation_' || t || '_service_role', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);',
      'rls_remediation_' || t || '_service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;',
                   'rls_remediation_' || t || '_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true);',
      'rls_remediation_' || t || '_read', t);
  END LOOP;
END
$rls$;

-- ----------------------------------------------------------------------------
-- Tier C.2 — Internal / eval / ops. No anon or authenticated need.
-- service_role-only (RLS on + service_role bypass => anon/authenticated denied).
-- ----------------------------------------------------------------------------
DO $rls$
DECLARE
  t text;
  internal_only text[] := ARRAY[
    'buddy_eval_runs','buddy_eval_scores','rate_limit_counters',
    'peis_mission_objects','pulse_projects','risk_factors'
  ];
BEGIN
  FOREACH t IN ARRAY internal_only LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      RAISE NOTICE 'RLS-REMEDIATION: table public.% not found — skipped', t;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;',
                   'rls_remediation_' || t || '_service_role', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);',
      'rls_remediation_' || t || '_service_role', t);
  END LOOP;
END
$rls$;

-- ----------------------------------------------------------------------------
-- Tier C.3 — Deal-derived, no DIRECT bank_id/deal_id column (reached via a
-- parent FK). RLS is enabled + service_role bypass NOW, which fully closes the
-- anon/authenticated hole (they are denied). The authenticated defense-in-depth
-- tenant policy requires a two-hop subquery through the parent; the exact
-- parent key column could not be verified against the live schema from here, so
-- per the spec ("do NOT guess an isolation column") the scoped authenticated
-- policy is left PROPOSED (below) for Matt to confirm + enable, rather than
-- guessed. Traced join paths (confirm columns live before enabling):
--
--   borrower_owner_attestations : borrower_id -> borrowers.(bank_id?)  [confirm borrowers tenant col]
--   buddy_covenant_overrides    : package_id  -> buddy_covenant_packages.deal_id -> deals.bank_id
--   deal_policy_exception_actions: exception_id -> deal_policy_exceptions.deal_id -> deals.bank_id
--   deal_watchlist_reasons      : watchlist_case_id -> deal_watchlist_cases.(bank_id) [Tier A parent]
--   memo_sections               : memo_run_id -> memo_runs.deal_id -> deals.bank_id  (memo_runs already RLS'd)
--
-- Example (memo_sections) — enable after confirming memo_runs.deal_id exists:
--   CREATE POLICY rls_remediation_memo_sections_tenant ON public.memo_sections
--     FOR ALL TO authenticated
--     USING (EXISTS (SELECT 1 FROM public.memo_runs mr JOIN public.deals d ON d.id::text = mr.deal_id::text
--                    WHERE mr.id = memo_sections.memo_run_id
--                      AND d.bank_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'bank_id','')));
-- ----------------------------------------------------------------------------
DO $rls$
DECLARE
  t text;
  deal_derived text[] := ARRAY[
    'borrower_owner_attestations','buddy_covenant_overrides',
    'deal_policy_exception_actions','deal_watchlist_reasons','memo_sections'
  ];
BEGIN
  FOREACH t IN ARRAY deal_derived LOOP
    IF to_regclass('public.' || quote_ident(t)) IS NULL THEN
      RAISE NOTICE 'RLS-REMEDIATION: table public.% not found — skipped', t;
      CONTINUE;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;',
                   'rls_remediation_' || t || '_service_role', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);',
      'rls_remediation_' || t || '_service_role', t);
    -- Scoped authenticated policy intentionally deferred (see header) — hole is
    -- already closed by the service_role-only policy above.
  END LOOP;
END
$rls$;

-- ----------------------------------------------------------------------------
-- Leftover backup table — drop instead of securing (confirmed unreferenced in
-- the codebase). IF EXISTS keeps this safe/idempotent.
-- ----------------------------------------------------------------------------
DROP TABLE IF EXISTS public.zz_finengine_golden_run_backup_20260627;

COMMIT;

-- ============================================================================
-- POST-APPLY VERIFICATION (run manually against the Buddy DB after apply).
--
-- Invariant (MUST return only intentional global-reference rows, ideally empty):
--   WITH rls AS (SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n
--                  ON n.oid=c.relnamespace AND n.nspname='public'
--                WHERE c.relkind='r' AND c.relrowsecurity=false),
--        grants AS (SELECT DISTINCT table_name FROM information_schema.role_table_grants
--                   WHERE table_schema='public' AND grantee IN ('anon','authenticated'))
--   SELECT r.relname FROM rls r JOIN grants g ON g.table_name=r.relname ORDER BY 1;
--
-- Policy-count (each secured table has >=1 policy; keyed tables have a
-- service_role bypass):
--   SELECT tablename, count(*) FROM pg_policies
--   WHERE schemaname='public' AND policyname LIKE 'rls_remediation_%'
--   GROUP BY tablename ORDER BY tablename;
-- ============================================================================
