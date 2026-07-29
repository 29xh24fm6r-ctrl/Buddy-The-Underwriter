BEGIN;

-- ============================================================
-- SPEC-SYSTEM-DEBLOAT-1 Phase C2 — Schema reap, batch 1 of 4.
--
-- Authorized by: docs/audit/schema-inventory-2026-07.md, lines 83-107
-- (the 25 rows classified **DROP**), approved in that doc's "Matt's
-- review" section, 2026-07-29 — all 82 DROP rows across all 4 batches
-- were approved in one review pass, but batches still apply and confirm
-- one at a time per spec (this is batch 1; do not author batch 2 until
-- this batch is confirmed applied clean in production).
--
-- Every table below: zero real rows, zero inbound/outbound FK edges,
-- zero dependent views/matviews, zero referencing functions, zero code
-- references (src/, services/, scripts/) — see the inventory doc for the
-- full per-table evidence. RESTRICT only, never CASCADE — a CASCADE
-- surprise here is exactly the failure mode this spec exists to prevent;
-- if any of these has an FK dependency this migration doesn't know
-- about, RESTRICT will fail loud instead of silently deleting dependent
-- data.
--
-- Pre-drop backup: schema-only DDL for every table below is already
-- committed at docs/audit/dropped-ddl/<table>.sql (generated 2026-07-29,
-- before this migration was authored) — restorable via
-- `psql "$BUDDY_DB_URL" -f docs/audit/dropped-ddl/<table>.sql` if needed.
--
-- BEFORE APPLYING: take a Supabase PITR checkpoint / confirm backup
-- recency. This is a destructive, hard-to-reverse operation on
-- production — the DDL backups restore structure, not any data (though
-- every table here has zero rows as of 2026-07-29, so there is no data
-- to lose in practice; the backup exists for structure/regression
-- safety, e.g. if a currently-dormant feature flag would have started
-- writing to one of these next week).
-- ============================================================

DROP TABLE public.aegis_recording_sessions RESTRICT;
DROP TABLE public.ai_gateway_calls RESTRICT;
DROP TABLE public.ai_run_events RESTRICT;
DROP TABLE public.attention_artifacts RESTRICT;
DROP TABLE public.autonomy_scores RESTRICT;
DROP TABLE public.bank_asset_text RESTRICT;
DROP TABLE public.bank_credit_policies RESTRICT;
DROP TABLE public.bank_profiles RESTRICT;
DROP TABLE public.banker_focus_sessions RESTRICT;
DROP TABLE public.borrower_access_tokens RESTRICT;
DROP TABLE public.borrower_automation_state RESTRICT;
DROP TABLE public.borrower_reminder_queue RESTRICT;
DROP TABLE public.brain_confidence_ledger RESTRICT;
DROP TABLE public.brain_decision_intents RESTRICT;
DROP TABLE public.brain_thought_artifacts RESTRICT;
DROP TABLE public.buddy_research_autonomy_settings RESTRICT;
DROP TABLE public.buddy_research_blocked_sources RESTRICT;
DROP TABLE public.buddy_research_plan_overrides RESTRICT;
DROP TABLE public.buddy_tuning_decisions RESTRICT;
DROP TABLE public.capital_allocation_events RESTRICT;
DROP TABLE public.closing_document_actions RESTRICT;
DROP TABLE public.dashboard_kpi_snapshots RESTRICT;
DROP TABLE public.deal_collateral_documents RESTRICT;
DROP TABLE public.deal_entity_relationships RESTRICT;
DROP TABLE public.deal_intercompany_transactions RESTRICT;

-- ─── Verify ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  tbls text[] := ARRAY[
    'aegis_recording_sessions','ai_gateway_calls','ai_run_events',
    'attention_artifacts','autonomy_scores','bank_asset_text',
    'bank_credit_policies','bank_profiles','banker_focus_sessions',
    'borrower_access_tokens','borrower_automation_state','borrower_reminder_queue',
    'brain_confidence_ledger','brain_decision_intents','brain_thought_artifacts',
    'buddy_research_autonomy_settings','buddy_research_blocked_sources',
    'buddy_research_plan_overrides','buddy_tuning_decisions',
    'capital_allocation_events','closing_document_actions','dashboard_kpi_snapshots',
    'deal_collateral_documents','deal_entity_relationships','deal_intercompany_transactions'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = t AND relnamespace = 'public'::regnamespace) THEN
      RAISE EXCEPTION 'batch 1 drop failed: % still exists', t;
    END IF;
  END LOOP;
END $$;

COMMIT;

-- Reload PostgREST schema cache so removed tables stop being routable
-- immediately, rather than waiting for the periodic auto-reload (~30s).
NOTIFY pgrst, 'reload schema';
