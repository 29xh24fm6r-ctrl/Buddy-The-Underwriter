-- Phase 56C.1: Rendering Spine Integration
-- Audit-grade document lineage for closing packages.

CREATE TABLE IF NOT EXISTS public.closing_document_renders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  closing_package_id uuid NOT NULL REFERENCES public.closing_packages(id) ON DELETE CASCADE,
  closing_package_document_id uuid NOT NULL REFERENCES public.closing_package_documents(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.loan_doc_templates(id),
  template_code text NOT NULL,
  template_version text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','rendering','rendered','failed','superseded')),
  render_input_snapshot jsonb NOT NULL,
  render_input_checksum text NOT NULL,
  output_checksum text,
  output_filled_document_id uuid,
  renderer_name text NOT NULL DEFAULT 'bank-docs/generate',
  renderer_version text,
  idempotency_key text,
  failure_code text,
  failure_detail text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  superseded_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_cdr_package ON public.closing_document_renders(closing_package_id);
CREATE INDEX IF NOT EXISTS idx_cdr_doc ON public.closing_document_renders(closing_package_document_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cdr_idempotency ON public.closing_document_renders(idempotency_key) WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.closing_package_documents
  ADD COLUMN IF NOT EXISTS current_render_id uuid,
  ADD COLUMN IF NOT EXISTS render_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS render_error text,
  ADD COLUMN IF NOT EXISTS rendered_at timestamptz,
  ADD COLUMN IF NOT EXISTS output_checksum text;

ALTER TABLE public.closing_document_renders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON public.closing_document_renders FOR ALL USING (true) WITH CHECK (true);
