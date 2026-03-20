-- QA mode + Sandbox access support

-- 1) Banks: mark sandbox tenants
ALTER TABLE public.banks
  ADD COLUMN IF NOT EXISTS is_sandbox boolean NOT NULL DEFAULT false;

-- 2) External banker sandbox allowlist
CREATE TABLE IF NOT EXISTS public.sandbox_access_allowlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NULL,
  domain text NULL,
  enabled boolean NOT NULL DEFAULT true,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sandbox_access_allowlist_has_target CHECK (email IS NOT NULL OR domain IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS sandbox_allowlist_email_idx
  ON public.sandbox_access_allowlist (lower(email))
  WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS sandbox_allowlist_domain_idx
  ON public.sandbox_access_allowlist (lower(domain))
  WHERE domain IS NOT NULL;

-- 3) QA click tracing events
CREATE TABLE IF NOT EXISTS public.qa_click_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id uuid NULL REFERENCES public.banks(id) ON DELETE SET NULL,
  clerk_user_id text NULL,
  session_id text NULL,
  path text NULL,
  event_type text NOT NULL DEFAULT 'click',
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qa_click_events_bank_idx
  ON public.qa_click_events (bank_id, created_at DESC);

CREATE INDEX IF NOT EXISTS qa_click_events_session_idx
  ON public.qa_click_events (session_id, created_at DESC);

-- 4) RLS: server-only (deny all)
ALTER TABLE public.sandbox_access_allowlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qa_click_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sandbox_access_allowlist_none ON public.sandbox_access_allowlist;
CREATE POLICY sandbox_access_allowlist_none
  ON public.sandbox_access_allowlist
  FOR ALL
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS qa_click_events_none ON public.qa_click_events;
CREATE POLICY qa_click_events_none
  ON public.qa_click_events
  FOR ALL
  USING (false)
  WITH CHECK (false);

-- 5) Seed sandbox tenant (idempotent)
INSERT INTO public.banks (code, name, is_sandbox)
VALUES ('SANDBOX', 'External Banker Sandbox', true)
ON CONFLICT (code)
DO UPDATE SET is_sandbox = true;
