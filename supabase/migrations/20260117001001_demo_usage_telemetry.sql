-- Demo usage telemetry (invite-only testing)

-- Optional: allowlist role (admin/banker/etc)
ALTER TABLE public.sandbox_access_allowlist
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'banker';

CREATE TABLE IF NOT EXISTS public.demo_user_activity (
  email text PRIMARY KEY,
  role text NOT NULL DEFAULT 'banker',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  last_path text,
  last_method text,
  last_ip text,
  last_user_agent text
);

CREATE TABLE IF NOT EXISTS public.demo_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  email text NOT NULL,
  event_type text NOT NULL, -- 'pageview' | 'click' | 'action'
  route text,
  label text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS demo_usage_events_created_at_idx
  ON public.demo_usage_events (created_at DESC);

CREATE INDEX IF NOT EXISTS demo_usage_events_email_created_at_idx
  ON public.demo_usage_events (email, created_at DESC);

-- RLS: server-only (deny all)
ALTER TABLE public.demo_user_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demo_usage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS demo_user_activity_none ON public.demo_user_activity;
CREATE POLICY demo_user_activity_none
  ON public.demo_user_activity
  FOR ALL
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS demo_usage_events_none ON public.demo_usage_events;
CREATE POLICY demo_usage_events_none
  ON public.demo_usage_events
  FOR ALL
  USING (false)
  WITH CHECK (false);
