-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for sms_subscriptions.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f sms_subscriptions.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.sms_subscriptions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  bank_id uuid,
  borrower_id uuid,
  phone_e164 text NOT NULL,
  status text NOT NULL,
  last_keyword text,
  last_keyword_at timestamp with time zone,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT sms_subscriptions_pkey PRIMARY KEY (id),
  CONSTRAINT sms_subscriptions_status_check CHECK ((status = ANY (ARRAY['subscribed'::text, 'unsubscribed'::text])))
);

CREATE UNIQUE INDEX sms_subscriptions_scope_uniq ON public.sms_subscriptions USING btree (bank_id, phone_e164);
