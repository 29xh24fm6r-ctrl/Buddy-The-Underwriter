-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for email_sender_profiles.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f email_sender_profiles.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.email_sender_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  sender_email text NOT NULL,
  sender_domain text,
  user_signal text,
  omega_class text DEFAULT 'unknown'::text,
  is_crm_contact boolean DEFAULT false,
  has_active_deal boolean DEFAULT false,
  total_received integer DEFAULT 0,
  total_replied integer DEFAULT 0,
  last_received_at timestamp with time zone,
  last_replied_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT email_sender_profiles_pkey PRIMARY KEY (id),
  CONSTRAINT email_sender_profiles_unique UNIQUE (user_id, sender_email)
);
