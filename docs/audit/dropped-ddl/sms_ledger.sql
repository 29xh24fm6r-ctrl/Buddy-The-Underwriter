-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for sms_ledger.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f sms_ledger.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.sms_ledger (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  bank_id uuid,
  deal_id uuid,
  borrower_id uuid,
  direction text NOT NULL,
  channel text NOT NULL DEFAULT 'sms'::text,
  to_e164 text NOT NULL,
  from_e164 text NOT NULL,
  provider text NOT NULL DEFAULT 'twilio'::text,
  provider_message_sid text,
  provider_messaging_service_sid text,
  body text NOT NULL,
  status text,
  error_code text,
  error_message text,
  kind text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  borrower_applicant_id uuid,
  CONSTRAINT sms_ledger_channel_check CHECK ((channel = 'sms'::text)),
  CONSTRAINT sms_ledger_direction_check CHECK ((direction = ANY (ARRAY['inbound'::text, 'outbound'::text]))),
  CONSTRAINT sms_ledger_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX sms_ledger_provider_sid_uniq ON public.sms_ledger USING btree (provider_message_sid) WHERE (provider_message_sid IS NOT NULL);
CREATE INDEX sms_ledger_borrower_applicant_id_idx ON public.sms_ledger USING btree (borrower_applicant_id);
