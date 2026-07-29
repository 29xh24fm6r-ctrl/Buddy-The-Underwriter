-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for support_sessions.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f support_sessions.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.support_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  bank_id uuid,
  deal_id uuid,
  borrower_session_token_hash text,
  status text NOT NULL DEFAULT 'active'::text,
  consent_given_at timestamp with time zone NOT NULL DEFAULT now(),
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  ended_at timestamp with time zone,
  page_url text,
  viewed_by_clerk_user_ids text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT support_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT support_sessions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'ended'::text])))
);

CREATE INDEX idx_support_sessions_deal_id ON public.support_sessions USING btree (deal_id) WHERE (deal_id IS NOT NULL);
CREATE INDEX idx_support_sessions_support_sessions_bank_id_fkey ON public.support_sessions USING btree (bank_id);
