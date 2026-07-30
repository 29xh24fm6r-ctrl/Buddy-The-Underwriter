-- SPEC-M8 ARTIFACT-PIPELINE-1 (audit fix, follow-up) — deal_business_plan_
-- attestations (20260803000000_business_plan_attestation.sql) shipped with
-- no RLS at all, a real deviation from every sibling table this program
-- created (deal_hostile_interrogations, deal_structured_field_confirmations,
-- borrower_fact_requests, fix_card_copy_cache all enable RLS). That
-- migration already merged to main, so per this repo's own convention
-- (confirmed via git history — migration files are never edited after
-- merge, only followed up) this is a separate migration rather than an
-- edit to the original file.
--
-- Idempotent: ENABLE ROW LEVEL SECURITY is safe to re-run, and the policy
-- is dropped-then-recreated so this migration is itself safe to re-run.
BEGIN;

ALTER TABLE public.deal_business_plan_attestations ENABLE ROW LEVEL SECURITY;

-- Bank-staff access, same shape as deal_hostile_interrogations/
-- deal_structured_field_confirmations. The borrower-portal route that reads/
-- writes this table uses supabaseAdmin() (service-role, bypasses RLS) per
-- this program's established portal-route convention, so this policy is
-- defense-in-depth for any future authenticated/anon-role access path, not
-- the primary access gate.
DROP POLICY IF EXISTS deal_business_plan_attestations_bank_access ON public.deal_business_plan_attestations;
CREATE POLICY deal_business_plan_attestations_bank_access
  ON public.deal_business_plan_attestations
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.bank_memberships bm
      WHERE bm.bank_id = deal_business_plan_attestations.bank_id
        AND bm.user_id = auth.uid()
        AND bm.role IN ('owner', 'admin', 'member')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bank_memberships bm
      WHERE bm.bank_id = deal_business_plan_attestations.bank_id
        AND bm.user_id = auth.uid()
        AND bm.role IN ('owner', 'admin', 'member')
    )
  );

COMMIT;
