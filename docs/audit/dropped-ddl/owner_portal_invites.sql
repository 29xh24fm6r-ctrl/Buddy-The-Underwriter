-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for owner_portal_invites.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f owner_portal_invites.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.owner_portal_invites (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  owner_entity_id uuid NOT NULL,
  invite_token_hash text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  status text NOT NULL DEFAULT 'created'::text,
  last_opened_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT owner_portal_invites_invite_token_hash_key UNIQUE (invite_token_hash),
  CONSTRAINT owner_portal_invites_pkey PRIMARY KEY (id),
  CONSTRAINT owner_portal_invites_status_check CHECK ((status = ANY (ARRAY['created'::text, 'sent'::text, 'opened'::text, 'active'::text, 'expired'::text, 'revoked'::text])))
);

CREATE INDEX idx_owner_portal_invites_owner_entity_id ON public.owner_portal_invites USING btree (owner_entity_id);
