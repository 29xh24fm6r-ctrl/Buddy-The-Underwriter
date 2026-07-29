-- SPEC-SYSTEM-DEBLOAT-1 Phase C3 — pre-drop DDL export for deal_intercompany_transactions.
-- Schema-only reconstruction (columns, defaults, PK/unique/check constraints,
-- non-PK indexes) via information_schema/pg_catalog, generated 2026-07-29 —
-- see scripts/audit/export-table-ddl.sh for methodology and caveats.
-- Restore: psql "$BUDDY_DB_URL" -f deal_intercompany_transactions.sql
-- (table was empty at drop time — this recreates structure only, no data)

CREATE TABLE public.deal_intercompany_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  transaction_type text NOT NULL,
  paying_entity_id uuid NOT NULL,
  receiving_entity_id uuid NOT NULL,
  annual_amount numeric(15,2) NOT NULL,
  detection_method text NOT NULL,
  confidence text NOT NULL DEFAULT 'medium'::text,
  paying_line_item text,
  receiving_line_item text,
  elimination_required boolean DEFAULT true,
  documentation text,
  banker_confirmed boolean DEFAULT false,
  tax_year integer,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT deal_intercompany_transactions_confidence_check CHECK ((confidence = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text]))),
  CONSTRAINT deal_intercompany_transactions_detection_method_check CHECK ((detection_method = ANY (ARRAY['tax_return_disclosure'::text, 'amount_match'::text, 'address_match'::text, 'schedule_e_cross_ref'::text, 'k1_scope_check'::text, 'manual'::text]))),
  CONSTRAINT deal_intercompany_transactions_pkey PRIMARY KEY (id),
  CONSTRAINT deal_intercompany_transactions_transaction_type_check CHECK ((transaction_type = ANY (ARRAY['rent'::text, 'management_fee'::text, 'royalties'::text, 'loan'::text, 'interest'::text, 'guarantee_fee'::text, 'services'::text, 'goods'::text])))
);

CREATE INDEX idx_ic_transactions_deal ON public.deal_intercompany_transactions USING btree (deal_id);
CREATE INDEX idx_ic_transactions_paying ON public.deal_intercompany_transactions USING btree (paying_entity_id);
CREATE INDEX idx_ic_transactions_receiving ON public.deal_intercompany_transactions USING btree (receiving_entity_id);
