-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for peis_result_quality.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f peis_result_quality.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.peis_result_quality (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  cycle_id text NOT NULL,
  query text NOT NULL,
  query_type text NOT NULL,
  source text NOT NULL,
  result_score smallint NOT NULL,
  failure_reason text,
  result_summary text NOT NULL,
  processing_time_ms integer,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT peis_result_quality_failure_reason_check CHECK ((failure_reason = ANY (ARRAY['wrong_domain'::text, 'no_data'::text, 'stale_data'::text, 'hallucinated'::text, 'misaligned'::text, 'timeout'::text, 'auth_error'::text]))),
  CONSTRAINT peis_result_quality_pkey PRIMARY KEY (id),
  CONSTRAINT peis_result_quality_query_type_check CHECK ((query_type = ANY (ARRAY['web_search'::text, 'email_scan'::text, 'calendar_read'::text, 'news_fetch'::text, 'contact_lookup'::text, 'task_scan'::text, 'custom'::text]))),
  CONSTRAINT peis_result_quality_result_score_check CHECK (((result_score >= 0) AND (result_score <= 3)))
);
