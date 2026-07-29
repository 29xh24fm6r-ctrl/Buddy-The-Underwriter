-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for overlay_generated_claims.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f overlay_generated_claims.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.overlay_generated_claims (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  bank_id uuid NOT NULL,
  overlay_id uuid NOT NULL,
  rule_id text NOT NULL,
  claim_hash text NOT NULL,
  topic text NOT NULL,
  predicate text NOT NULL,
  value_json jsonb NOT NULL,
  constraint_type text,
  requirement_level text NOT NULL DEFAULT 'bank'::text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT overlay_generated_claims_bank_id_check CHECK ((bank_id IS NOT NULL)),
  CONSTRAINT overlay_generated_claims_pkey PRIMARY KEY (id)
);

CREATE INDEX idx_overlay_claims_deal_id ON public.overlay_generated_claims USING btree (deal_id);
CREATE INDEX idx_overlay_claims_overlay_id ON public.overlay_generated_claims USING btree (overlay_id);
CREATE INDEX idx_overlay_claims_hash ON public.overlay_generated_claims USING btree (claim_hash);
