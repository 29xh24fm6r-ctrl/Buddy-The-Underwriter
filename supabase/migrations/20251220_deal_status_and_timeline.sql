-- 20251220_deal_status_and_timeline.sql

-- ---------------------------------------------
-- 1) Enums (optional, but keeps stages consistent)
-- ---------------------------------------------
DO $$ BEGIN
  CREATE TYPE deal_stage AS ENUM (
    'intake',
    'docs_in_progress',
    'analysis',
    'underwriting',
    'conditional_approval',
    'closing',
    'funded',
    'declined'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------
-- 2) Deal Status (borrower-safe fields only)
-- ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.deal_status (
  deal_id uuid PRIMARY KEY,
  stage deal_stage NOT NULL DEFAULT 'intake',
  eta_date date NULL,
  eta_note text NULL, -- borrower-safe, optional (e.g. "Waiting on appraisal scheduling")
  updated_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deal_status_stage_idx ON public.deal_status(stage);
CREATE INDEX IF NOT EXISTS deal_status_eta_idx ON public.deal_status(eta_date);

-- Keep updated_at fresh
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_deal_status_updated_at ON public.deal_status;
CREATE TRIGGER trg_deal_status_updated_at
BEFORE UPDATE ON public.deal_status
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------
-- 3) Deal Timeline Events (real, persisted)
-- ---------------------------------------------
CREATE TABLE IF NOT EXISTS public.deal_timeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  kind text NOT NULL, -- 'stage_changed' | 'eta_changed' | 'doc_received' | 'message_sent' | etc.
  title text NOT NULL,
  detail text NULL,
  visible_to_borrower boolean NOT NULL DEFAULT true,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deal_timeline_deal_id_idx ON public.deal_timeline_events(deal_id);
CREATE INDEX IF NOT EXISTS deal_timeline_visible_idx ON public.deal_timeline_events(deal_id, visible_to_borrower, created_at DESC);

-- (Optional) FK if you have a deals table; otherwise comment this out safely.
-- ALTER TABLE public.deal_timeline_events
--   ADD CONSTRAINT deal_timeline_events_deal_fk
--   FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE CASCADE;

-- ---------------------------------------------
-- 4) RLS
-- You can adapt "is banker" + "is borrower/invite" to your auth model.
-- This is intentionally conservative: borrowers only see borrower-safe fields/events.
-- ---------------------------------------------
ALTER TABLE public.deal_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_timeline_events ENABLE ROW LEVEL SECURITY;

-- Helper: treat "banker" as anyone assigned on deal_assignees OR role claim, etc.
-- Replace this with your canonical logic if you already have it.
CREATE OR REPLACE FUNCTION public.is_deal_banker(_deal_id uuid)
RETURNS boolean AS $$
BEGIN
  -- If you have deal_assignees table: (deal_id, user_id)
  IF EXISTS (
    SELECT 1
    FROM public.deal_assignees a
    WHERE a.deal_id = _deal_id
      AND a.user_id = auth.uid()
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
EXCEPTION
  WHEN undefined_table THEN
    -- If deal_assignees doesn't exist yet, default false at DB level.
    RETURN false;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Deal Status policies:
DROP POLICY IF EXISTS deal_status_banker_read ON public.deal_status;
DROP POLICY IF EXISTS deal_status_banker_write ON public.deal_status;
DROP POLICY IF EXISTS deal_status_borrower_read ON public.deal_status;

-- Bankers can read
CREATE POLICY deal_status_banker_read
ON public.deal_status
FOR SELECT
USING (public.is_deal_banker(deal_id));

-- Bankers can upsert/update
CREATE POLICY deal_status_banker_write
ON public.deal_status
FOR ALL
USING (public.is_deal_banker(deal_id))
WITH CHECK (public.is_deal_banker(deal_id));

-- Borrower read:
-- If you have a borrower portal table, swap this for your real rule.
-- For now, borrowers will read status ONLY via server route using supabaseAdmin.
-- This policy can remain strict:
CREATE POLICY deal_status_borrower_read
ON public.deal_status
FOR SELECT
USING (false);

-- Timeline policies:
DROP POLICY IF EXISTS deal_timeline_banker_read ON public.deal_timeline_events;
DROP POLICY IF EXISTS deal_timeline_banker_write ON public.deal_timeline_events;
DROP POLICY IF EXISTS deal_timeline_borrower_read ON public.deal_timeline_events;

-- Bankers can read/write
CREATE POLICY deal_timeline_banker_read
ON public.deal_timeline_events
FOR SELECT
USING (public.is_deal_banker(deal_id));

CREATE POLICY deal_timeline_banker_write
ON public.deal_timeline_events
FOR ALL
USING (public.is_deal_banker(deal_id))
WITH CHECK (public.is_deal_banker(deal_id));

-- Borrowers: same approach (server-only), keep DB strict:
CREATE POLICY deal_timeline_borrower_read
ON public.deal_timeline_events
FOR SELECT
USING (false);
