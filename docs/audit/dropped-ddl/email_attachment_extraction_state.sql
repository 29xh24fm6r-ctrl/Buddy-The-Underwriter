-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for email_attachment_extraction_state.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f email_attachment_extraction_state.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.email_attachment_extraction_state (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  attachment_id text NOT NULL,
  thread_id text NOT NULL,
  message_id text,
  text_extraction_status text NOT NULL DEFAULT 'pending'::text,
  text_extraction_error text,
  text_extracted_at timestamp with time zone,
  text_hash text,
  page_count integer,
  parser_version text DEFAULT '1.0.0'::text,
  evidence_ready boolean DEFAULT false,
  evidence_confidence double precision,
  last_repair_requested_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT email_attachment_extraction_state_pkey PRIMARY KEY (id),
  CONSTRAINT email_attachment_extraction_state_text_extraction_status_check CHECK ((text_extraction_status = ANY (ARRAY['pending'::text, 'extracting'::text, 'extracted'::text, 'failed'::text, 'unsupported'::text])))
);
