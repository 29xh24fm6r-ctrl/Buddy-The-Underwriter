-- SPEC-M8 ARTIFACT-PIPELINE-1 (audit fix, follow-up) — three small hygiene
-- fixes surfaced by a full-system audit, against already-merged migrations
-- this program authored. Per this repo's convention (migration files are
-- never edited post-merge), these are new statements, not edits to the
-- original files.
BEGIN;

-- 1) borrower_fact_requests.deal_id (20260729000001_beat_metrics.sql) had no
--    ON DELETE CASCADE — every sibling deal-scoped table this program
--    created (deal_hostile_interrogations, deal_structured_field_
--    confirmations, deal_business_plan_attestations) uses CASCADE. Without
--    it, goldenRun.ts's cleanupGoldenRun (which already deletes
--    borrower_fact_requests explicitly before deleting the deal row) works
--    fine, but any OTHER deal-deletion path that doesn't know to pre-delete
--    this specific table would hit a foreign-key violation instead of
--    cascading. Postgres's default auto-generated name for an unnamed
--    inline REFERENCES constraint is "<table>_<column>_fkey".
ALTER TABLE public.borrower_fact_requests
  DROP CONSTRAINT IF EXISTS borrower_fact_requests_deal_id_fkey;

ALTER TABLE public.borrower_fact_requests
  ADD CONSTRAINT borrower_fact_requests_deal_id_fkey
  FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE CASCADE;

-- 2) deal_hostile_interrogations (20260801000000_...sql) and
--    deal_structured_field_confirmations (20260802000000_...sql) each
--    ended with a bare `CREATE POLICY` and no transaction wrapper — a
--    partial-apply retry of either original file would fail with "policy
--    already exists" (CREATE POLICY has no IF NOT EXISTS form). Restating
--    both policies here via drop-then-create closes that gap going
--    forward: this migration (which IS wrapped in BEGIN/COMMIT) always
--    leaves both policies in the same defined state regardless of how the
--    original files' own apply history went.
DROP POLICY IF EXISTS deal_hostile_interrogations_bank_access ON public.deal_hostile_interrogations;
CREATE POLICY deal_hostile_interrogations_bank_access
  ON public.deal_hostile_interrogations
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.bank_memberships bm
      WHERE bm.bank_id = deal_hostile_interrogations.bank_id
        AND bm.user_id = auth.uid()
        AND bm.role IN ('owner', 'admin', 'member')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bank_memberships bm
      WHERE bm.bank_id = deal_hostile_interrogations.bank_id
        AND bm.user_id = auth.uid()
        AND bm.role IN ('owner', 'admin', 'member')
    )
  );

DROP POLICY IF EXISTS deal_structured_field_confirmations_bank_access ON public.deal_structured_field_confirmations;
CREATE POLICY deal_structured_field_confirmations_bank_access
  ON public.deal_structured_field_confirmations
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.bank_memberships bm
      WHERE bm.bank_id = deal_structured_field_confirmations.bank_id
        AND bm.user_id = auth.uid()
        AND bm.role IN ('owner', 'admin', 'member')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.bank_memberships bm
      WHERE bm.bank_id = deal_structured_field_confirmations.bank_id
        AND bm.user_id = auth.uid()
        AND bm.role IN ('owner', 'admin', 'member')
    )
  );

COMMIT;
