-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for closing_document_actions.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f closing_document_actions.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.closing_document_actions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  closing_package_id uuid NOT NULL,
  closing_package_document_id uuid,
  recipient_id uuid,
  action_type text NOT NULL,
  actor_user_id text,
  actor_type text,
  provider_name text,
  provider_envelope_id text,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT closing_document_actions_action_type_check CHECK ((action_type = ANY (ARRAY['prepared'::text, 'sent'::text, 'resent'::text, 'viewed'::text, 'signed'::text, 'completed'::text, 'voided'::text, 'downloaded'::text, 'uploaded_counterpart'::text, 'waived'::text, 'failed'::text, 'superseded'::text]))),
  CONSTRAINT closing_document_actions_actor_type_check CHECK ((actor_type = ANY (ARRAY['banker'::text, 'borrower'::text, 'system'::text, 'provider'::text]))),
  CONSTRAINT closing_document_actions_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_cda_deal ON public.closing_document_actions USING btree (deal_id);
CREATE INDEX idx_cda_package ON public.closing_document_actions USING btree (closing_package_id);
CREATE INDEX idx_closing_document_actions_closing_document_actions_closing_p ON public.closing_document_actions USING btree (closing_package_document_id);
CREATE INDEX idx_closing_document_actions_closing_document_actions_recipient ON public.closing_document_actions USING btree (recipient_id);
