-- Reconstructed from live schema (supabase_migrations.schema_migrations) --
-- applied directly to the production project and never committed to the
-- repo. Captured verbatim for governance/reproducibility (see CRM audit,
-- 2026-07-16).

-- SPEC-OUTSTANDING-FIXES-BATCH-1 Fix 6
-- Add service_role bypass policies to all tables with RLS but zero policies.
-- These tables are accessed exclusively via supabaseAdmin() (service_role).
-- Policies are defense-in-depth — prevents silent empty results if any
-- client-side code accidentally reads these tables directly.

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'aegis_recording_sessions','bank_policy_packs','bank_registry_pins',
    'brokerage_alert_events','brokerage_alert_subscriptions','brokerage_alerts',
    'brokerage_borrower_message_outbox','brokerage_borrower_message_templates',
    'brokerage_closing_conditions','brokerage_closing_events','brokerage_closing_workflows',
    'brokerage_condition_evidence','brokerage_conversion_events','brokerage_disclosures',
    'brokerage_fee_config','brokerage_fee_ledger','brokerage_funding_verifications',
    'brokerage_leads','brokerage_lender_message_outbox','brokerage_lender_message_templates',
    'brokerage_notification_outbox','brokerage_revenue_events','buddy_borrower_stories',
    'buddy_shadow_brain_results','deal_consolidations','deal_document_slot_attachments',
    'deal_document_slots','deal_entity_relationships','deal_extraction_runs',
    'deal_intercompany_transactions','doc_extraction_cache','doc_gatekeeper_cache',
    'examiner_access_grants','examiner_activity_log','exec_outbox',
    'legal_documents','sba_form_159_records','tasks','virus_scan_cache'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    -- Only add if table exists and has no policies yet
    IF EXISTS (
      SELECT 1 FROM pg_tables
      WHERE schemaname = 'public' AND tablename = tbl
    ) AND NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = tbl
    ) THEN
      EXECUTE format(
        'CREATE POLICY "service_role_all" ON public.%I AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true)',
        tbl
      );
    END IF;
  END LOOP;
END $$;
