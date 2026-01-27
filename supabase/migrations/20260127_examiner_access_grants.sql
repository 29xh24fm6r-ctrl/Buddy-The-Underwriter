-- Phase L: Examiner Access Grants
-- Time-bounded, scoped access grants for regulatory examiners.
-- Every grant is explicit, auto-expires, revocable, and ledgered.

BEGIN;

-- ── Examiner Access Grants ──────────────────────────────

CREATE TABLE IF NOT EXISTS public.examiner_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_code text NOT NULL UNIQUE DEFAULT ('EAG-' || substr(gen_random_uuid()::text, 1, 8)),
  examiner_name text NOT NULL,
  organization text NOT NULL,
  bank_id uuid NOT NULL REFERENCES public.banks(id) ON DELETE CASCADE,
  scope jsonb NOT NULL DEFAULT '{}',
  -- scope example: { "deal_ids": ["uuid1","uuid2"], "read_areas": ["borrower","decision","financials","audit"] }
  granted_by_user_id text NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NULL,
  revoked_by_user_id text NULL,
  revoke_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.examiner_access_grants IS
  'Time-bounded access grants for regulatory examiners. Every grant is explicit, scoped, and auto-expires.';

COMMENT ON COLUMN public.examiner_access_grants.scope IS
  'JSON object with deal_ids (array of UUIDs) and read_areas (array of strings). Examiner can only view deals and areas listed.';

COMMENT ON COLUMN public.examiner_access_grants.expires_at IS
  'Grant automatically expires at this timestamp. No extension without new grant.';

-- ── Indexes ─────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_examiner_access_grants_bank_id
  ON public.examiner_access_grants (bank_id);

CREATE INDEX IF NOT EXISTS idx_examiner_access_grants_expires_at
  ON public.examiner_access_grants (expires_at)
  WHERE revoked_at IS NULL;

-- ── RLS (server-only) ───────────────────────────────────

ALTER TABLE public.examiner_access_grants ENABLE ROW LEVEL SECURITY;

-- ── Bank Policy Packs (Phase J) ─────────────────────────

CREATE TABLE IF NOT EXISTS public.bank_policy_packs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id uuid NOT NULL REFERENCES public.banks(id) ON DELETE CASCADE,
  policy_version text NOT NULL DEFAULT '1.0',
  effective_at timestamptz NOT NULL DEFAULT now(),
  supersedes_id uuid NULL REFERENCES public.bank_policy_packs(id),
  rules_json jsonb NOT NULL DEFAULT '[]',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.bank_policy_packs IS
  'Versioned bank credit policy packs. Immutable once active. Superseded by newer versions.';

CREATE INDEX IF NOT EXISTS idx_bank_policy_packs_bank_active
  ON public.bank_policy_packs (bank_id, active, effective_at DESC);

ALTER TABLE public.bank_policy_packs ENABLE ROW LEVEL SECURITY;

-- ── Examiner Activity Log ───────────────────────────────

CREATE TABLE IF NOT EXISTS public.examiner_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL REFERENCES public.examiner_access_grants(id) ON DELETE CASCADE,
  action text NOT NULL,
  -- actions: 'viewed_deal', 'viewed_borrower', 'viewed_decision', 'viewed_artifacts', 'verified_integrity'
  deal_id uuid NULL,
  detail jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.examiner_activity_log IS
  'Immutable log of every examiner action. Every view and verification is traceable.';

CREATE INDEX IF NOT EXISTS idx_examiner_activity_log_grant_id
  ON public.examiner_activity_log (grant_id);

CREATE INDEX IF NOT EXISTS idx_examiner_activity_log_deal_id
  ON public.examiner_activity_log (deal_id)
  WHERE deal_id IS NOT NULL;

ALTER TABLE public.examiner_activity_log ENABLE ROW LEVEL SECURITY;

COMMIT;
