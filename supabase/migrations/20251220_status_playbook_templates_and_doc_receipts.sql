-- 20251220_status_playbook_templates_and_doc_receipts.sql

-- ------------------------------------------------------------
-- 1) Stage Playbook (borrower-safe checklist per stage)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deal_stage_playbook (
  stage text PRIMARY KEY,
  borrower_title text NOT NULL,
  borrower_steps jsonb NOT NULL DEFAULT '[]'::jsonb, -- array of strings
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Updated_at trigger (reuse if already present)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_deal_stage_playbook_updated_at ON public.deal_stage_playbook;
CREATE TRIGGER trg_deal_stage_playbook_updated_at
BEFORE UPDATE ON public.deal_stage_playbook
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- Seed defaults (safe to re-run)
INSERT INTO public.deal_stage_playbook(stage, borrower_title, borrower_steps)
VALUES
  ('intake', 'Intake', '[
    "Confirm your business legal name and entity type",
    "Upload the most recent 2 years business tax returns (if applicable)",
    "Upload most recent year-end financials (if available)"
  ]'::jsonb),
  ('docs_in_progress', 'Documents in progress', '[
    "Upload any missing documents shown in your checklist",
    "If you have multiple entities, upload returns for each entity",
    "If you have an appraisal/valuation request, we will notify you here"
  ]'::jsonb),
  ('analysis', 'Analysis', '[
    "We are reviewing your financials and cash flow",
    "Be ready to answer clarifying questions if we message you",
    "If you have updated interim financials, upload them anytime"
  ]'::jsonb),
  ('underwriting', 'Underwriting', '[
    "Your file is in underwriting review",
    "If underwriting requests items, they will appear in your checklist",
    "We will keep your ETA updated here"
  ]'::jsonb),
  ('conditional_approval', 'Conditional approval', '[
    "Review and complete any conditions listed in your checklist",
    "If third parties are involved (title/insurance/appraisal), we will track progress here",
    "Upload anything requested as soon as possible to keep the timeline moving"
  ]'::jsonb),
  ('closing', 'Closing', '[
    "We are preparing closing documents",
    "We will message you with signing instructions",
    "Confirm any final details promptly to avoid delays"
  ]'::jsonb),
  ('funded', 'Funded', '[
    "Funds have been disbursed",
    "Keep copies of your closing documents for your records",
    "Reach out if you need anything post-close"
  ]'::jsonb),
  ('declined', 'Declined', '[
    "We were not able to approve at this time",
    "If you would like to review options, message us and we can discuss next steps"
  ]'::jsonb)
ON CONFLICT (stage) DO UPDATE
SET borrower_title = EXCLUDED.borrower_title,
    borrower_steps = EXCLUDED.borrower_steps,
    updated_at = now();

-- ------------------------------------------------------------
-- 2) Banker ETA Note Templates (quick apply)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deal_eta_note_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  note text NOT NULL, -- borrower-safe template body
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deal_eta_note_templates_created_by_idx
  ON public.deal_eta_note_templates(created_by, created_at DESC);

-- Seed a few defaults (global)
INSERT INTO public.deal_eta_note_templates(label, note, created_by)
VALUES
  ('Ordered appraisal', 'We have ordered the appraisal/valuation and will update you when it is scheduled.', NULL),
  ('Waiting on third-party', 'We are waiting on a third-party item (e.g. title/insurance/appraisal). We will keep this updated.', NULL),
  ('Underwriting review', 'Your request is currently under review. We will update you if anything is needed.', NULL),
  ('Closing in progress', 'We are preparing closing documents. We will message you with next steps for signing.', NULL)
ON CONFLICT DO NOTHING;

-- ------------------------------------------------------------
-- 3) Doc Receipts (simple table upload pipeline can write to)
--    Trigger logs borrower-visible timeline events.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deal_document_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  file_name text NOT NULL,
  doc_type text NULL, -- e.g. "Tax Return", "PFS", "Bank Statement"
  doc_year int NULL,  -- optional: 2023
  source text NOT NULL DEFAULT 'upload', -- upload|email|portal|banker
  received_by uuid NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deal_document_receipts_deal_idx
  ON public.deal_document_receipts(deal_id, received_at DESC);

-- Timeline function assumes deal_timeline_events exists from prior sprint
CREATE OR REPLACE FUNCTION public.on_doc_receipt_log_timeline()
RETURNS trigger AS $$
DECLARE
  v_title text;
  v_detail text;
BEGIN
  v_title := 'Document received';
  v_detail := NEW.file_name;

  IF NEW.doc_type IS NOT NULL AND NEW.doc_year IS NOT NULL THEN
    v_title := NEW.doc_type || ' received';
    v_detail := NEW.doc_year::text || ' • ' || NEW.file_name;
  ELSIF NEW.doc_type IS NOT NULL THEN
    v_title := NEW.doc_type || ' received';
    v_detail := NEW.file_name;
  END IF;

  INSERT INTO public.deal_timeline_events (
    deal_id, kind, title, detail, visible_to_borrower, created_by, created_at
  ) VALUES (
    NEW.deal_id,
    'doc_received',
    'Bank received: ' || v_title,
    v_detail,
    true,
    NEW.received_by,
    NEW.received_at
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_doc_receipt_log_timeline ON public.deal_document_receipts;
CREATE TRIGGER trg_doc_receipt_log_timeline
AFTER INSERT ON public.deal_document_receipts
FOR EACH ROW
EXECUTE FUNCTION public.on_doc_receipt_log_timeline();

-- ------------------------------------------------------------
-- 4) RLS (keep strict; use server routes/admin for borrower)
-- ------------------------------------------------------------
ALTER TABLE public.deal_stage_playbook ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_eta_note_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_document_receipts ENABLE ROW LEVEL SECURITY;

-- Playbook: allow public read via server route only (keep DB strict)
DROP POLICY IF EXISTS playbook_select_none ON public.deal_stage_playbook;
CREATE POLICY playbook_select_none ON public.deal_stage_playbook
FOR SELECT USING (false);

-- Templates: allow only via server route (keep DB strict)
DROP POLICY IF EXISTS templates_select_none ON public.deal_eta_note_templates;
CREATE POLICY templates_select_none ON public.deal_eta_note_templates
FOR SELECT USING (false);

DROP POLICY IF EXISTS templates_write_none ON public.deal_eta_note_templates;
CREATE POLICY templates_write_none ON public.deal_eta_note_templates
FOR ALL USING (false) WITH CHECK (false);

-- Doc receipts: only via server route / admin
DROP POLICY IF EXISTS receipts_none ON public.deal_document_receipts;
CREATE POLICY receipts_none ON public.deal_document_receipts
FOR ALL USING (false) WITH CHECK (false);
