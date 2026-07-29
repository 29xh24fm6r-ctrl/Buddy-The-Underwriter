-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for borrower_reminder_queue.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f borrower_reminder_queue.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.borrower_reminder_queue (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  bank_id uuid,
  deal_id uuid,
  borrower_id uuid,
  phone_e164 text NOT NULL,
  rule_id uuid NOT NULL,
  next_send_at timestamp with time zone NOT NULL,
  sends_count integer NOT NULL DEFAULT 0,
  last_sent_at timestamp with time zone,
  status text NOT NULL DEFAULT 'scheduled'::text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT borrower_reminder_queue_pkey PRIMARY KEY (id),
  CONSTRAINT borrower_reminder_queue_status_check CHECK ((status = ANY (ARRAY['scheduled'::text, 'paused'::text, 'completed'::text])))
);

CREATE INDEX idx_borrower_reminder_queue_borrower_reminder_queue_rule_id_fke ON public.borrower_reminder_queue USING btree (rule_id);
