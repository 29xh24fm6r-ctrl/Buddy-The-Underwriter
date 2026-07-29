BEGIN;

-- ============================================================
-- SPEC-SYSTEM-DEBLOAT-1 Phase C2 — Schema reap, batch 1 of 2 (corrected).
--
-- Authorized by: docs/audit/schema-inventory-2026-07.md, lines 103-160
-- (25 of the 32 rows classified **DROP** under the corrected,
-- oid-based FK classification), approved in that doc's "✅ Approved
-- 2026-07-29 (same day) — all 32 corrected DROP rows, both batches"
-- section.
--
-- This replaces the original batch-1 migration
-- (20260729010000_schema_reap_batch_1.sql, now deleted), which was
-- authored against a classification with a broken FK-detection query
-- (regclass::text prefix mismatch — see the doc's CORRECTION section)
-- and never successfully applied: it failed on `ai_run_events`, a real
-- inbound FK the broken query reported as zero, and rolled back cleanly
-- via RESTRICT + the transaction wrapper. None of the 25 tables below
-- were in that failed batch's overlap set with a real FK — all 25 here
-- were re-verified with the corrected oid-based join and show zero
-- inbound/outbound FK edges, zero dependent views/matviews, zero
-- referencing functions, zero code references (src/, services/,
-- scripts/), and zero real rows.
--
-- RESTRICT only, never CASCADE — a CASCADE surprise here is exactly the
-- failure mode this spec exists to prevent; if any of these has an FK
-- dependency this migration doesn't know about, RESTRICT will fail loud
-- instead of silently deleting dependent data.
--
-- Pre-drop backup: schema-only DDL for every table below is already
-- committed at docs/audit/dropped-ddl/<table>.sql — restorable via
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
DROP TABLE public.attention_artifacts RESTRICT;
DROP TABLE public.autonomy_scores RESTRICT;
DROP TABLE public.borrower_automation_state RESTRICT;
DROP TABLE public.brain_confidence_ledger RESTRICT;
DROP TABLE public.brain_decision_intents RESTRICT;
DROP TABLE public.brain_thought_artifacts RESTRICT;
DROP TABLE public.buddy_research_autonomy_settings RESTRICT;
DROP TABLE public.buddy_research_blocked_sources RESTRICT;
DROP TABLE public.buddy_research_plan_overrides RESTRICT;
DROP TABLE public.capital_allocation_events RESTRICT;
DROP TABLE public.dashboard_kpi_snapshots RESTRICT;
DROP TABLE public.deal_message_suggestions RESTRICT;
DROP TABLE public.deal_status_history RESTRICT;
DROP TABLE public.deal_status_summary RESTRICT;
DROP TABLE public.delivery_trackers RESTRICT;
DROP TABLE public.email_attachment_extraction_state RESTRICT;
DROP TABLE public.email_operational_obligations RESTRICT;
DROP TABLE public.email_operator_repairs RESTRICT;
DROP TABLE public.email_pipeline_jobs RESTRICT;
DROP TABLE public.email_sender_profiles RESTRICT;
DROP TABLE public.email_situations RESTRICT;
DROP TABLE public.email_thread_priority_explanations RESTRICT;
DROP TABLE public.ledger_fiscal_periods RESTRICT;
DROP TABLE public.peis_result_quality RESTRICT;

-- ─── Verify ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  tbls text[] := ARRAY[
    'aegis_recording_sessions','attention_artifacts','autonomy_scores',
    'borrower_automation_state','brain_confidence_ledger','brain_decision_intents',
    'brain_thought_artifacts','buddy_research_autonomy_settings',
    'buddy_research_blocked_sources','buddy_research_plan_overrides',
    'capital_allocation_events','dashboard_kpi_snapshots','deal_message_suggestions',
    'deal_status_history','deal_status_summary','delivery_trackers',
    'email_attachment_extraction_state','email_operational_obligations',
    'email_operator_repairs','email_pipeline_jobs','email_sender_profiles',
    'email_situations','email_thread_priority_explanations','ledger_fiscal_periods',
    'peis_result_quality'
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
