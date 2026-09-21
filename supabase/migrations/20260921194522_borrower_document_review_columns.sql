-- Reconcile existing production columns with the migration schema.
-- Unknown OCR length stays NULL and cannot pass automated admission.
ALTER TABLE public.deal_documents
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ocr_text_length integer;
