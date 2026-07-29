-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for email_intelligence_prefetch_cache.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f email_intelligence_prefetch_cache.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.email_intelligence_prefetch_cache (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id_uuid uuid NOT NULL,
  thread_id text NOT NULL,
  thread_db_id uuid,
  cortex_status text,
  gemini_ran boolean DEFAULT false,
  emotional_posture text,
  consequence_tier text,
  prefetched_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT email_intelligence_prefetch_cache_pkey PRIMARY KEY (id),
  CONSTRAINT email_intelligence_prefetch_cache_user_id_uuid_thread_id_key UNIQUE (user_id_uuid, thread_id)
);

CREATE INDEX email_intelligence_prefetch_cach_user_id_uuid_prefetched_at_idx ON public.email_intelligence_prefetch_cache USING btree (user_id_uuid, prefetched_at DESC);
