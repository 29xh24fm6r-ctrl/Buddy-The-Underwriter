BEGIN;

CREATE TABLE IF NOT EXISTS public.third_party_vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id uuid NOT NULL REFERENCES public.banks(id) ON DELETE CASCADE,

  vendor_type text NOT NULL CHECK (vendor_type IN (
    'appraiser','business_valuator','environmental_consultant',
    'insurance_carrier','title_company','ucc_search_service'
  )),
  legal_name text NOT NULL,
  contact_email text,
  contact_phone text,
  service_regions text[],
  certifications text[],

  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tpv_bank ON public.third_party_vendors(bank_id, vendor_type)
  WHERE is_active;

ALTER TABLE public.third_party_vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY tpv_deny ON public.third_party_vendors FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY tpv_select_bank ON public.third_party_vendors FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id=third_party_vendors.bank_id AND m.user_id=auth.uid())
);

CREATE TABLE IF NOT EXISTS public.third_party_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),

  order_type text NOT NULL CHECK (order_type IN (
    'real_estate_appraisal','business_valuation','phase_1_environmental',
    'phase_2_environmental','hazard_insurance','life_insurance',
    'title_commitment','ucc_lien_search'
  )),
  vendor_id uuid REFERENCES public.third_party_vendors(id),

  status text NOT NULL DEFAULT 'triggered' CHECK (status IN (
    'triggered','dispatched','in_progress','delivered','parsed','cancelled'
  )),

  trigger_reason text,
  triggered_at timestamptz NOT NULL DEFAULT now(),

  order_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ordered_at timestamptz,
  ordered_by_user_id text,
  expected_completion_at timestamptz,
  estimated_cost numeric,

  delivered_at timestamptz,
  result_storage_path text,
  result_parsed_json jsonb,
  parsed_at timestamptz,

  cancellation_reason text,
  cancelled_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tpo_deal ON public.third_party_orders(deal_id);
CREATE INDEX idx_tpo_pending ON public.third_party_orders(deal_id, status)
  WHERE status IN ('triggered','dispatched','in_progress','delivered');
CREATE INDEX idx_tpo_overdue ON public.third_party_orders(expected_completion_at)
  WHERE status IN ('dispatched','in_progress') AND expected_completion_at IS NOT NULL;

ALTER TABLE public.third_party_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY tpo_deny ON public.third_party_orders FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY tpo_select_bank ON public.third_party_orders FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id=third_party_orders.bank_id AND m.user_id=auth.uid())
);

DROP TRIGGER IF EXISTS trg_tpv_updated_at ON public.third_party_vendors;
CREATE TRIGGER trg_tpv_updated_at BEFORE UPDATE ON public.third_party_vendors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS trg_tpo_updated_at ON public.third_party_orders;
CREATE TRIGGER trg_tpo_updated_at BEFORE UPDATE ON public.third_party_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMIT;
