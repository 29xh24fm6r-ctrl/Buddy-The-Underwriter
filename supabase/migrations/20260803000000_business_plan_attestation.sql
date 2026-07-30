-- SPEC-M8 ARTIFACT-PIPELINE-1 — borrower attestation for the AI-generated
-- SBA business plan (buddy_sba_packages). Mirrors the immutable-snapshot
-- pattern already established by borrower_owner_attestations
-- (20260127000001_borrower_confidence_attestation.sql): append-only, one
-- row per attestation event, never updated in place.
--
-- narrative_snapshot_hash lets a later reader tell whether the plan text
-- has changed since the borrower attested (the package pipeline has no
-- input-hash/regeneration-guard of its own — see sbaPackageOrchestrator.ts
-- — so a fresh regeneration must invalidate a stale attestation rather than
-- silently keep showing it as current).
--
-- business_plan_attested / business_plan_attested_at on buddy_trident_bundles
-- are informational only (read at bundle-generation time, non-blocking) —
-- generateTridentBundle.ts already has multiple live, automated callers
-- (borrower preview, admin/bank-staff trigger, marketplace-pick final-mode
-- generation) that must keep working with zero borrower interaction; hard-
-- blocking bundle generation on attestation would regress those paths.
BEGIN;

CREATE TABLE IF NOT EXISTS public.deal_business_plan_attestations (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id                 uuid        NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id                 uuid        NOT NULL REFERENCES public.banks(id) ON DELETE CASCADE,
  package_id              uuid        REFERENCES public.buddy_sba_packages(id),
  narrative_snapshot_hash text        NOT NULL,
  attested_by_name        text,
  attested_by_email       text,
  attested_at             timestamptz NOT NULL DEFAULT now(),
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deal_business_plan_attestations_deal_idx
  ON public.deal_business_plan_attestations (deal_id, attested_at DESC);

ALTER TABLE public.buddy_trident_bundles
  ADD COLUMN IF NOT EXISTS business_plan_attested boolean,
  ADD COLUMN IF NOT EXISTS business_plan_attested_at timestamptz;

COMMIT;
