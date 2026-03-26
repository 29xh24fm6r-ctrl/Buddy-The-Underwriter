-- Phase 56C: Loan Docs Generation & Closing Package Foundation

-- 1. Closing packages (versioned, auditable)
CREATE TABLE IF NOT EXISTS public.closing_packages (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id               uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  package_type          text NOT NULL DEFAULT 'loan_docs' CHECK (package_type IN ('loan_docs','closing_package')),
  product_type          text NOT NULL,
  status                text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','generation_in_progress','generated','needs_review','approved_for_send','sent','partially_executed','fully_executed','superseded','failed')),
  generation_version    int NOT NULL DEFAULT 1,
  generated_from_json   jsonb NOT NULL DEFAULT '{}',
  blockers_json         jsonb NOT NULL DEFAULT '[]',
  warnings_json         jsonb NOT NULL DEFAULT '[]',
  document_count        int NOT NULL DEFAULT 0,
  generated_at          timestamptz,
  generated_by          text,
  supersedes_package_id uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cp_deal_id ON public.closing_packages(deal_id);
CREATE INDEX IF NOT EXISTS idx_cp_status ON public.closing_packages(status);

-- 2. Individual documents within a package
CREATE TABLE IF NOT EXISTS public.closing_package_documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closing_package_id  uuid NOT NULL REFERENCES public.closing_packages(id) ON DELETE CASCADE,
  document_type       text NOT NULL,
  title               text NOT NULL,
  storage_ref         text,
  version             int NOT NULL DEFAULT 1,
  status              text NOT NULL DEFAULT 'generated' CHECK (status IN ('generated','reviewed','approved','superseded')),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cpd_package ON public.closing_package_documents(closing_package_id);

-- 3. Closing checklist items (live, not just PDF)
CREATE TABLE IF NOT EXISTS public.closing_checklist_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id             uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  closing_package_id  uuid REFERENCES public.closing_packages(id),
  item_type           text NOT NULL,
  title               text NOT NULL,
  required            boolean NOT NULL DEFAULT true,
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','received','waived','complete')),
  owner               text NOT NULL DEFAULT 'banker' CHECK (owner IN ('banker','borrower','counsel','system')),
  source_action_id    text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cci_deal_id ON public.closing_checklist_items(deal_id);
CREATE INDEX IF NOT EXISTS idx_cci_package ON public.closing_checklist_items(closing_package_id);
CREATE INDEX IF NOT EXISTS idx_cci_status ON public.closing_checklist_items(status);

-- 4. Loan document templates
CREATE TABLE IF NOT EXISTS public.loan_doc_templates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key        text NOT NULL UNIQUE,
  product_type        text NOT NULL,
  jurisdiction_scope  text,
  version             text NOT NULL DEFAULT 'v1',
  supported_features  jsonb NOT NULL DEFAULT '[]',
  is_active           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ldt_product ON public.loan_doc_templates(product_type);

-- Seed first-wave templates
INSERT INTO public.loan_doc_templates (template_key, product_type, version, supported_features) VALUES
  ('term_loan_standard', 'term', 'v1', '["promissory_note","guaranty","security_agreement","closing_checklist"]'),
  ('loc_standard', 'loc', 'v1', '["promissory_note","guaranty","security_agreement","borrowing_base","closing_checklist"]'),
  ('sba_7a_standard', 'sba-7a', 'v1', '["sba_note","sba_guaranty","sba_authorization","closing_checklist"]'),
  ('cre_standard', 'cre', 'v1', '["promissory_note","guaranty","deed_of_trust","closing_checklist"]')
ON CONFLICT (template_key) DO NOTHING;

-- RLS
ALTER TABLE public.closing_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.closing_package_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.closing_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_doc_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON public.closing_packages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access" ON public.closing_package_documents FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access" ON public.closing_checklist_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access" ON public.loan_doc_templates FOR ALL USING (true) WITH CHECK (true);
