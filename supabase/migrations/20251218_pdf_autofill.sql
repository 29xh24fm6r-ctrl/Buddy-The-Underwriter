-- PDF Auto-Fill Engine Tables
-- Stores parsed template fields and fill runs for audit/reproducibility

BEGIN;

-- 1) Parsed fields for each bank template (AcroForm)
CREATE TABLE IF NOT EXISTS public.bank_document_template_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES public.bank_document_templates(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  field_type TEXT NULL,
  is_required BOOLEAN NOT NULL DEFAULT false,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(template_id, field_name)
);

CREATE INDEX IF NOT EXISTS idx_bdtf_template
  ON public.bank_document_template_fields(template_id);

COMMENT ON TABLE public.bank_document_template_fields IS 'Parsed AcroForm fields from bank PDF templates';
COMMENT ON COLUMN public.bank_document_template_fields.field_name IS 'PDF form field name (e.g., borrower_name)';
COMMENT ON COLUMN public.bank_document_template_fields.field_type IS 'PDF field type (text, checkbox, etc.)';
COMMENT ON COLUMN public.bank_document_template_fields.meta IS 'Additional field metadata (default value, validation, etc.)';

-- 2) A "fill run" record (audit + reproducibility)
CREATE TABLE IF NOT EXISTS public.bank_document_fill_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES public.bank_document_templates(id),
  deal_id UUID NOT NULL,
  created_by_clerk_user_id TEXT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','READY','GENERATED','FAILED')),
  field_values JSONB NOT NULL DEFAULT '{}'::jsonb, -- final deterministic values
  ai_notes JSONB NOT NULL DEFAULT '{}'::jsonb,     -- explain-only suggestions
  error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bdfill_deal
  ON public.bank_document_fill_runs(deal_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bdfill_template
  ON public.bank_document_fill_runs(template_id, created_at DESC);

COMMENT ON TABLE public.bank_document_fill_runs IS 'Audit log for PDF form fill operations (reproducible + traceable)';
COMMENT ON COLUMN public.bank_document_fill_runs.field_values IS 'Deterministic field values applied to PDF (rules-based)';
COMMENT ON COLUMN public.bank_document_fill_runs.ai_notes IS 'AI suggestions for review (never auto-applied)';

COMMIT;
