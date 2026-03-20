-- 20260204_create_bank_loan_product_types.sql
-- Bank-scoped product type overrides: controls which loan products are
-- available per bank (credit policy). Falls back to global catalog if empty.

BEGIN;

CREATE TABLE IF NOT EXISTS public.bank_loan_product_types (
  bank_id uuid NOT NULL REFERENCES public.banks(id) ON DELETE CASCADE,
  product_code text NOT NULL REFERENCES public.loan_product_types(code) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  display_name text NULL,
  sort_order integer NULL,
  required_fields_json jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bank_id, product_code)
);

CREATE INDEX IF NOT EXISTS bank_loan_product_types_bank_id_idx
  ON public.bank_loan_product_types(bank_id);

COMMIT;
