-- Phase 84 T-01 Batch A — Tenant isolation wall (highest-risk tables only)
--
-- Enables RLS on 14 tables carrying raw facts, memo content, and OCR bytes.
-- Service-role bypasses policies (this is what supabaseAdmin() uses).
-- `authenticated` role gets a bank_id-scoped policy.
--
-- Dormant-policy disclosure: the `authenticated` policy references
-- request.jwt.claims->>'bank_id' which is not currently minted by
-- src/app/api/auth/supabase-jwt/route.ts. No production code path
-- currently uses an RLS-respecting Supabase client against these tables.
-- Tracked as Phase 84.1 follow-up.
--
-- Spec deviations (documented in docs/archive/phase-84/AAR_PHASE_84_T01.md):
--   1. credit_memo_drafts, credit_memo_snapshots moved from tables_with_bank_id
--      to tables_deal_only_uuid (no bank_id column).
--   2. memo_runs, risk_runs use text-typed deal_id; split into
--      tables_deal_only_text with d.id::text = t.deal_id predicate.
--
-- Rollback: DROP POLICY phase84a_* + ALTER TABLE ... DISABLE ROW LEVEL SECURITY.

DO $$
DECLARE
  t text;
  tables_with_bank_id text[] := ARRAY[
    'deal_financial_facts','deal_spreads','canonical_memo_narratives',
    'document_artifacts','deal_truth_events',
    'deal_upload_sessions','deal_upload_session_files'
  ];
  tables_deal_only_uuid text[] := ARRAY[
    'credit_memo_drafts','credit_memo_snapshots',
    'credit_memo_citations','document_ocr_words','document_ocr_page_map'
  ];
  tables_deal_only_text text[] := ARRAY['memo_runs','risk_runs'];
BEGIN
  FOREACH t IN ARRAY tables_with_bank_id LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);',
      'phase84a_' || t || '_service_role', t
    );
    EXECUTE format(
      $q$CREATE POLICY %I ON public.%I
         FOR ALL TO authenticated
         USING (bank_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'bank_id', ''))
         WITH CHECK (bank_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'bank_id', ''));$q$,
      'phase84a_' || t || '_tenant_scope', t
    );
  END LOOP;

  FOREACH t IN ARRAY tables_deal_only_uuid LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);',
      'phase84a_' || t || '_service_role', t
    );
    EXECUTE format(
      $q$CREATE POLICY %I ON public.%I
         FOR ALL TO authenticated
         USING (EXISTS (
           SELECT 1 FROM public.deals d
           WHERE d.id = %I.deal_id
             AND d.bank_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'bank_id', '')
         ));$q$,
      'phase84a_' || t || '_tenant_scope', t, t
    );
  END LOOP;

  FOREACH t IN ARRAY tables_deal_only_text LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);',
      'phase84a_' || t || '_service_role', t
    );
    EXECUTE format(
      $q$CREATE POLICY %I ON public.%I
         FOR ALL TO authenticated
         USING (EXISTS (
           SELECT 1 FROM public.deals d
           WHERE d.id::text = %I.deal_id
             AND d.bank_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'bank_id', '')
         ));$q$,
      'phase84a_' || t || '_tenant_scope', t, t
    );
  END LOOP;
END$$;
