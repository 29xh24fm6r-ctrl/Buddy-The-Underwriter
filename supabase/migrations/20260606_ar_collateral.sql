-- AR collateral layer: AR aging reports, customer/invoice breakdown, borrowing base calculations.
-- Reverse-engineered from live schema; matches dev DB exactly (FKs, defaults, RLS, naming).

-- ============================================================================
-- ar_aging_reports
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ar_aging_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL,
  source_document_id uuid REFERENCES public.deal_documents(id) ON DELETE SET NULL,
  as_of_date date,
  total_ar numeric,
  current_amount numeric,
  days_30 numeric,
  days_60 numeric,
  days_90 numeric,
  days_120 numeric,
  extraction_status text DEFAULT 'pending'::text,
  raw_json jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.ar_aging_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ar_aging_reports_tenant_scope ON public.ar_aging_reports;
CREATE POLICY ar_aging_reports_tenant_scope
  ON public.ar_aging_reports
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (
    (bank_id)::text = COALESCE(
      ((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'bank_id'::text),
      ''::text
    )
  )
  WITH CHECK (
    (bank_id)::text = COALESCE(
      ((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'bank_id'::text),
      ''::text
    )
  );

-- ============================================================================
-- ar_aging_customers
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ar_aging_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.ar_aging_reports(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL,
  bank_id uuid NOT NULL,
  customer_name text,
  total_amount numeric,
  current_amount numeric,
  days_30 numeric,
  days_60 numeric,
  days_90 numeric,
  days_120 numeric,
  concentration_pct numeric,
  is_ineligible boolean DEFAULT false,
  ineligibility_reason text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.ar_aging_customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ar_aging_customers_tenant_scope ON public.ar_aging_customers;
CREATE POLICY ar_aging_customers_tenant_scope
  ON public.ar_aging_customers
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (
    (bank_id)::text = COALESCE(
      ((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'bank_id'::text),
      ''::text
    )
  )
  WITH CHECK (
    (bank_id)::text = COALESCE(
      ((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'bank_id'::text),
      ''::text
    )
  );

-- ============================================================================
-- ar_aging_invoices
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.ar_aging_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.ar_aging_reports(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.ar_aging_customers(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL,
  bank_id uuid NOT NULL,
  invoice_number text,
  invoice_date date,
  amount numeric,
  days_past_due integer,
  bucket text,
  is_ineligible boolean DEFAULT false,
  ineligibility_reason text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.ar_aging_invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ar_aging_invoices_tenant_scope ON public.ar_aging_invoices;
CREATE POLICY ar_aging_invoices_tenant_scope
  ON public.ar_aging_invoices
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (
    (bank_id)::text = COALESCE(
      ((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'bank_id'::text),
      ''::text
    )
  )
  WITH CHECK (
    (bank_id)::text = COALESCE(
      ((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'bank_id'::text),
      ''::text
    )
  );

-- ============================================================================
-- borrowing_base_calculations
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.borrowing_base_calculations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL,
  report_id uuid REFERENCES public.ar_aging_reports(id) ON DELETE SET NULL,
  gross_ar numeric,
  ineligible_ar numeric,
  eligible_ar numeric,
  advance_rate numeric,
  concentration_reserve numeric,
  dilution_reserve numeric,
  net_availability numeric,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.borrowing_base_calculations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS borrowing_base_tenant_scope ON public.borrowing_base_calculations;
CREATE POLICY borrowing_base_tenant_scope
  ON public.borrowing_base_calculations
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (
    (bank_id)::text = COALESCE(
      ((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'bank_id'::text),
      ''::text
    )
  )
  WITH CHECK (
    (bank_id)::text = COALESCE(
      ((current_setting('request.jwt.claims'::text, true))::jsonb ->> 'bank_id'::text),
      ''::text
    )
  );
