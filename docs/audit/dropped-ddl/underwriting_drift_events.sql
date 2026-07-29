-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for underwriting_drift_events.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f underwriting_drift_events.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.underwriting_drift_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  drift_type text NOT NULL,
  severity text NOT NULL,
  summary text NOT NULL,
  details_json jsonb NOT NULL,
  detected_at timestamp with time zone NOT NULL DEFAULT now(),
  resolved_at timestamp with time zone,
  resolution_type text,
  CONSTRAINT underwriting_drift_events_pkey PRIMARY KEY (id),
  CONSTRAINT uw_drift_resolution_ck CHECK (((resolution_type IS NULL) OR (resolution_type = ANY (ARRAY['ignored'::text, 'refreshed'::text, 'relaunched'::text])))),
  CONSTRAINT uw_drift_severity_ck CHECK ((severity = ANY (ARRAY['warning'::text, 'material'::text])))
);

CREATE INDEX idx_uw_drift_workspace ON public.underwriting_drift_events USING btree (workspace_id, detected_at DESC);
CREATE INDEX idx_underwriting_drift_events_underwriting_drift_events_deal_id ON public.underwriting_drift_events USING btree (deal_id);
CREATE INDEX idx_underwriting_drift_events_underwriting_drift_events_snapsho ON public.underwriting_drift_events USING btree (snapshot_id);
