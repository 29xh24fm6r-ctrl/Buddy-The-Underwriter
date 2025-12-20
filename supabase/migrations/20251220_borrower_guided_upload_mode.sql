-- 20251220_borrower_guided_upload_mode.sql

-- ------------------------------------------------------------
-- Borrower Guided Upload Mode
-- Canonical rules:
-- - RLS enabled + deny-all (server routes only)
-- - Borrower sees only borrower-safe views via portal endpoints
-- ------------------------------------------------------------

-- Checklist item definitions per deal (borrower-safe labels)
CREATE TABLE IF NOT EXISTS public.deal_portal_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  code text NOT NULL, -- stable identifier e.g. "TAX_RETURNS_2023"
  title text NOT NULL, -- borrower-friendly
  description text NULL, -- borrower-friendly helper text
  group_name text NOT NULL DEFAULT 'Documents',
  sort_order int NOT NULL DEFAULT 0,

  -- matching hints (server-only) used for auto-completion from doc receipt
  match_hints jsonb NOT NULL DEFAULT '[]'::jsonb, -- e.g. ["tax return 2023", "irs form 1120s 2023"]

  required boolean NOT NULL DEFAULT true,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT deal_portal_checklist_items_unique UNIQUE (deal_id, code)
);

CREATE INDEX IF NOT EXISTS deal_portal_checklist_items_deal_idx
  ON public.deal_portal_checklist_items(deal_id, group_name, sort_order);

-- Checklist status per deal+item (computed by server, stored for timeline + de-dupe)
CREATE TABLE IF NOT EXISTS public.deal_portal_checklist_state (
  deal_id uuid NOT NULL,
  item_id uuid NOT NULL REFERENCES public.deal_portal_checklist_items(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('missing','received','verified')) DEFAULT 'missing',
  completed_at timestamptz NULL,
  last_receipt_id uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (deal_id, item_id)
);

CREATE INDEX IF NOT EXISTS deal_portal_checklist_state_deal_idx
  ON public.deal_portal_checklist_state(deal_id, status, updated_at DESC);

-- Upload receipts (borrower-safe summary of "we got it")
CREATE TABLE IF NOT EXISTS public.deal_document_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  uploader_role text NOT NULL CHECK (uploader_role IN ('borrower','banker')),
  file_id uuid NULL, -- optional link to your existing files table if you have one
  filename text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),

  -- server-only enrichment (never shown directly)
  meta jsonb NULL
);

CREATE INDEX IF NOT EXISTS deal_document_receipts_deal_idx
  ON public.deal_document_receipts(deal_id, received_at DESC);

-- Borrower portal chat (borrower-safe, no risk data)
CREATE TABLE IF NOT EXISTS public.deal_portal_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  sender_role text NOT NULL CHECK (sender_role IN ('borrower','banker')),
  sender_display text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deal_portal_chat_messages_deal_idx
  ON public.deal_portal_chat_messages(deal_id, created_at DESC);

-- Borrower-safe stage + ETA (banker sets; borrower reads)
CREATE TABLE IF NOT EXISTS public.deal_portal_status (
  deal_id uuid PRIMARY KEY,
  stage text NOT NULL DEFAULT 'Intake', -- borrower-safe labels only
  eta_text text NULL, -- e.g. "1–2 business days"
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- updated_at triggers (expects public.set_updated_at() already exists in your project)
DROP TRIGGER IF EXISTS trg_deal_portal_checklist_items_updated_at ON public.deal_portal_checklist_items;
CREATE TRIGGER trg_deal_portal_checklist_items_updated_at
BEFORE UPDATE ON public.deal_portal_checklist_items
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_deal_portal_checklist_state_updated_at ON public.deal_portal_checklist_state;
CREATE TRIGGER trg_deal_portal_checklist_state_updated_at
BEFORE UPDATE ON public.deal_portal_checklist_state
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_deal_portal_status_updated_at ON public.deal_portal_status;
CREATE TRIGGER trg_deal_portal_status_updated_at
BEFORE UPDATE ON public.deal_portal_status
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- ------------------------------------------------------------
-- RLS: deny all (server routes only)
-- ------------------------------------------------------------
ALTER TABLE public.deal_portal_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_portal_checklist_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_document_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_portal_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_portal_status ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_portal_checklist_items_none ON public.deal_portal_checklist_items;
CREATE POLICY deal_portal_checklist_items_none ON public.deal_portal_checklist_items
FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deal_portal_checklist_state_none ON public.deal_portal_checklist_state;
CREATE POLICY deal_portal_checklist_state_none ON public.deal_portal_checklist_state
FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deal_document_receipts_none ON public.deal_document_receipts;
CREATE POLICY deal_document_receipts_none ON public.deal_document_receipts
FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deal_portal_chat_messages_none ON public.deal_portal_chat_messages;
CREATE POLICY deal_portal_chat_messages_none ON public.deal_portal_chat_messages
FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deal_portal_status_none ON public.deal_portal_status;
CREATE POLICY deal_portal_status_none ON public.deal_portal_status
FOR ALL USING (false) WITH CHECK (false);
