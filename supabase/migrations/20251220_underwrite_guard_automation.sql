-- 20251220_underwrite_guard_automation.sql

-- ------------------------------------------------------------
-- Canonical principle:
-- - All tables are RLS enabled with deny-all policies
-- - Only server routes (supabaseAdmin) interact with them
-- ------------------------------------------------------------

-- 1) Store last guard state per deal (for transitions + de-dupe)
CREATE TABLE IF NOT EXISTS public.deal_underwrite_guard_states (
  deal_id uuid PRIMARY KEY,
  severity text NOT NULL CHECK (severity IN ('BLOCKED','WARN','READY')),
  blocked_count int NOT NULL DEFAULT 0,
  warn_count int NOT NULL DEFAULT 0,
  issues jsonb NOT NULL DEFAULT '[]'::jsonb,
  issues_hash text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2) Timeline events (banker-only or borrower-visible)
CREATE TABLE IF NOT EXISTS public.deal_timeline_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('banker','borrower')),
  event_type text NOT NULL, -- e.g. UNDERWRITE_GUARD_TRANSITION, UNDERWRITE_STATUS_UPDATED
  title text NOT NULL,
  detail text NULL,
  meta jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deal_timeline_events_deal_idx
  ON public.deal_timeline_events(deal_id, created_at DESC);

-- 3) Next Actions (auto-generated from guard, banker-only by default)
CREATE TABLE IF NOT EXISTS public.deal_next_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('banker','borrower')),
  status text NOT NULL CHECK (status IN ('open','done')) DEFAULT 'open',

  code text NOT NULL, -- stable identifier e.g. UW_MISSING_AMOUNT
  title text NOT NULL,
  detail text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{label, value, source}]
  action_target jsonb NOT NULL DEFAULT '{}'::jsonb, -- {kind, dealId}

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- de-dupe: one open action per code per deal
  CONSTRAINT deal_next_actions_unique_open UNIQUE (deal_id, code, status)
);

CREATE INDEX IF NOT EXISTS deal_next_actions_deal_idx
  ON public.deal_next_actions(deal_id, status, updated_at DESC);

DROP TRIGGER IF EXISTS trg_deal_next_actions_updated_at ON public.deal_next_actions;
CREATE TRIGGER trg_deal_next_actions_updated_at
BEFORE UPDATE ON public.deal_next_actions
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- 4) Borrower nudge drafts (banker approves before sending)
CREATE TABLE IF NOT EXISTS public.deal_message_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  to_role text NOT NULL CHECK (to_role IN ('borrower')),
  status text NOT NULL CHECK (status IN ('draft','approved','sent')) DEFAULT 'draft',

  body text NOT NULL,

  created_by text NULL, -- banker user id
  approved_by text NULL,
  sent_by text NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz NULL,
  sent_at timestamptz NULL,

  meta jsonb NULL
);

CREATE INDEX IF NOT EXISTS deal_message_drafts_deal_idx
  ON public.deal_message_drafts(deal_id, status, created_at DESC);

-- ------------------------------------------------------------
-- RLS: deny all (server routes only)
-- ------------------------------------------------------------
ALTER TABLE public.deal_underwrite_guard_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_timeline_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_next_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_message_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deal_underwrite_guard_states_none ON public.deal_underwrite_guard_states;
CREATE POLICY deal_underwrite_guard_states_none ON public.deal_underwrite_guard_states
FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deal_timeline_events_none ON public.deal_timeline_events;
CREATE POLICY deal_timeline_events_none ON public.deal_timeline_events
FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deal_next_actions_none ON public.deal_next_actions;
CREATE POLICY deal_next_actions_none ON public.deal_next_actions
FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS deal_message_drafts_none ON public.deal_message_drafts;
CREATE POLICY deal_message_drafts_none ON public.deal_message_drafts
FOR ALL USING (false) WITH CHECK (false);
