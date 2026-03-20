-- 20251220_chat_and_checklist_highlight.sql

-- ------------------------------------------------------------
-- 1) Deal Chat Messages
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deal_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,

  sender_role text NOT NULL CHECK (sender_role IN ('banker','borrower')),
  sender_user_id uuid NULL,
  sender_display text NULL,

  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  borrower_visible boolean NOT NULL DEFAULT true,
  banker_visible boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS deal_messages_deal_created_idx
  ON public.deal_messages(deal_id, created_at DESC);

CREATE INDEX IF NOT EXISTS deal_messages_role_idx
  ON public.deal_messages(deal_id, sender_role, created_at DESC);

-- ------------------------------------------------------------
-- 2) Read Receipts / Unread Counts (per deal, per banker)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.deal_message_reads (
  deal_id uuid NOT NULL,
  banker_user_id uuid NOT NULL,
  last_read_at timestamptz NOT NULL DEFAULT 'epoch'::timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (deal_id, banker_user_id)
);

-- updated_at helper (safe to redefine)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_deal_message_reads_updated_at ON public.deal_message_reads;
CREATE TRIGGER trg_deal_message_reads_updated_at
BEFORE UPDATE ON public.deal_message_reads
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS deal_message_reads_banker_idx
  ON public.deal_message_reads(banker_user_id, updated_at DESC);

-- ------------------------------------------------------------
-- 3) Add meta jsonb to timeline events for deterministic highlights
-- ------------------------------------------------------------
ALTER TABLE public.deal_timeline_events
ADD COLUMN IF NOT EXISTS meta jsonb NULL;

-- ------------------------------------------------------------
-- 4) RLS: keep strict; serve via server routes (admin)
-- ------------------------------------------------------------
ALTER TABLE public.deal_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_message_reads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_messages_none ON public.deal_messages;
CREATE POLICY deal_messages_none ON public.deal_messages
FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deal_message_reads_none ON public.deal_message_reads;
CREATE POLICY deal_message_reads_none ON public.deal_message_reads
FOR ALL USING (false) WITH CHECK (false);
