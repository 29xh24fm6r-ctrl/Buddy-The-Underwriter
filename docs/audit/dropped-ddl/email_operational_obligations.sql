-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for email_operational_obligations.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f email_operational_obligations.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.email_operational_obligations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  dedupe_key text NOT NULL,
  obligation_title text NOT NULL,
  obligation_type text NOT NULL DEFAULT 'other_operational_obligation'::text,
  action_required text NOT NULL DEFAULT ''::text,
  action_url text,
  due_at timestamp with time zone,
  expiry_at timestamp with time zone,
  urgency text NOT NULL DEFAULT 'pending'::text,
  status text NOT NULL DEFAULT 'open'::text,
  source_thread_ids text[] NOT NULL DEFAULT '{}'::text[],
  nag_count integer NOT NULL DEFAULT 1,
  latest_received_at timestamp with time zone,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT email_operational_obligations_pkey PRIMARY KEY (id),
  CONSTRAINT email_operational_obligations_unique UNIQUE (user_id, dedupe_key)
);
