-- Pulled forward from Sprint 4 per specs/brokerage/revisions-round-4.md S1-1.
-- Sprints 4 and 6 both assume this column exists; adding it here means every
-- subsequent sprint has a deterministic Clerk-org-to-bank lookup path.
ALTER TABLE public.banks
  ADD COLUMN IF NOT EXISTS clerk_org_id text;

CREATE UNIQUE INDEX IF NOT EXISTS banks_clerk_org_id_idx
  ON public.banks (clerk_org_id)
  WHERE clerk_org_id IS NOT NULL;

COMMENT ON COLUMN public.banks.clerk_org_id IS
  'Clerk organization ID for tenant resolution. NULL for legacy banks not yet linked. Lookup pattern: getAuth() -> orgId -> banks WHERE clerk_org_id = orgId. Brokerage tenant does NOT set this (operated via bank_user_memberships only); lender tenants set it at Sprint 4 provisioning time.';
