BEGIN;

-- ============================================================
-- SPEC-DRIFT-HARDENING-1 D4 — re-drop aegis_recording_sessions (RETIRE).
--
-- History: aegis_recording_sessions was dropped by
-- 20260729030000_schema_reap_batch_1.sql (SPEC-SYSTEM-DEBLOAT-1 Phase C2).
-- Its two live callers — src/app/api/aegis/recording/start/route.ts and
-- .../stop/route.ts — still referenced it via a cast
-- (`.from("aegis_recording_sessions" as any)`) that evaded the
-- then-current guard-dropped-tables.mjs regex (fixed in this same spec,
-- D1), so those two routes silently started 500ing in production once the
-- drop landed. The table was restored from its schema-only DDL backup
-- (docs/audit/dropped-ddl/aegis_recording_sessions.sql) as incident
-- remediation while screen-recording's product status was confirmed.
--
-- Per Matt's 2026-07-30 decision (aegis screen-recording is not a live or
-- planned feature — RETIRE, not KEEP) and this spec's §0 V0.3 inbound-
-- reference inventory (zero callers beyond the two now-deleted route
-- files; the separate /api/aegis/findings + findings/resolve routes are
-- an unrelated feature and are untouched), the two route files are deleted
-- in this same PR and this migration re-drops the table cleanly — this
-- time with nothing left depending on it.
--
-- RESTRICT, not CASCADE, per this repo's established schema-reap
-- convention: if some other, currently-unknown dependency exists, this
-- fails loud instead of silently cascading.
--
-- DDL backup unchanged at docs/audit/dropped-ddl/aegis_recording_sessions.sql
-- — restorable via `psql "$BUDDY_DB_URL" -f
-- docs/audit/dropped-ddl/aegis_recording_sessions.sql` if screen-recording
-- is ever revived.
-- ============================================================

DROP TABLE IF EXISTS public.aegis_recording_sessions RESTRICT;

-- ─── Verify ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE relname = 'aegis_recording_sessions' AND relnamespace = 'public'::regnamespace
  ) THEN
    RAISE EXCEPTION 'aegis_recording_sessions still exists after re-drop';
  END IF;
END $$;

COMMIT;

-- Reload PostgREST schema cache so the removed table stops being routable
-- immediately, rather than waiting for the periodic auto-reload (~30s).
NOTIFY pgrst, 'reload schema';
