BEGIN;

-- ============================================================
-- SPEC-SYSTEM-DEBLOAT-1 Phase C2 — Schema reap, batch 2 of 2 (corrected, final).
--
-- Authorized by: docs/audit/schema-inventory-2026-07.md, lines 161-184
-- (the remaining 7 of the 32 rows classified **DROP** under the
-- corrected, oid-based FK classification), approved in that doc's
-- "✅ Approved 2026-07-29 (same day) — all 32 corrected DROP rows, both
-- batches" section. Batch 1 (25 tables,
-- 20260729030000_schema_reap_batch_1.sql) applied clean in production
-- prior to this batch being authored, per spec sequencing.
--
-- Every table below: zero real rows, zero inbound/outbound FK edges
-- (oid-based join, not the broken regclass::text comparison — see the
-- doc's CORRECTION section), zero dependent views/matviews, zero
-- referencing functions, zero code references (src/, services/,
-- scripts/).
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
--
-- This is the final batch — once applied clean, all 32 tables approved
-- in the corrected classification will have been dropped.
-- ============================================================

DROP TABLE public.peis_routing_preferences RESTRICT;
DROP TABLE public.peis_voice_results RESTRICT;
DROP TABLE public.rule_evaluation_runs RESTRICT;
DROP TABLE public.sms_subscriptions RESTRICT;
DROP TABLE public.third_brain_ambient_cache RESTRICT;
DROP TABLE public.voice_session_summaries RESTRICT;
DROP TABLE public.xp_logs RESTRICT;

-- ─── Verify ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
  tbls text[] := ARRAY[
    'peis_routing_preferences','peis_voice_results','rule_evaluation_runs',
    'sms_subscriptions','third_brain_ambient_cache','voice_session_summaries',
    'xp_logs'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = t AND relnamespace = 'public'::regnamespace) THEN
      RAISE EXCEPTION 'batch 2 drop failed: % still exists', t;
    END IF;
  END LOOP;
END $$;

COMMIT;

-- Reload PostgREST schema cache so removed tables stop being routable
-- immediately, rather than waiting for the periodic auto-reload (~30s).
NOTIFY pgrst, 'reload schema';
