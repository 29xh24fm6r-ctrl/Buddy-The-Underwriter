-- ============================================================================
-- Sprint 3: Trident bundles (business plan, projections, feasibility) with
-- preview vs final mode, status state machine, and partial unique
-- "exactly one current succeeded bundle per (deal, mode)" guarantee.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.buddy_trident_bundles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),

  mode text NOT NULL CHECK (mode IN ('preview', 'final')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),

  -- Artifact paths (populated as each renderer completes).
  business_plan_pdf_path text,
  projections_pdf_path text,
  projections_xlsx_path text,
  feasibility_pdf_path text,

  -- Source version pointers (forensics — which package/feasibility backed this).
  source_sba_package_id uuid REFERENCES public.buddy_sba_packages(id),
  source_feasibility_id uuid REFERENCES public.buddy_feasibility_studies(id),

  version integer NOT NULL DEFAULT 1,

  generation_started_at timestamptz,
  generation_completed_at timestamptz,
  generation_error text,

  -- Redactor version for preview bundles (NULL for final).
  redactor_version text,

  generated_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz
);

CREATE INDEX IF NOT EXISTS buddy_trident_bundles_deal_id_idx
  ON public.buddy_trident_bundles (deal_id);
CREATE INDEX IF NOT EXISTS buddy_trident_bundles_bank_id_idx
  ON public.buddy_trident_bundles (bank_id);
CREATE INDEX IF NOT EXISTS buddy_trident_bundles_status_idx
  ON public.buddy_trident_bundles (status);

-- S3-2: exactly one current (non-superseded, succeeded) bundle per (deal, mode).
-- Failed bundles never supersede the previous success.
CREATE UNIQUE INDEX IF NOT EXISTS buddy_trident_bundles_one_current_per_deal_mode
  ON public.buddy_trident_bundles (deal_id, mode)
  WHERE superseded_at IS NULL AND status = 'succeeded';

ALTER TABLE public.buddy_trident_bundles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trident_bundles_select_for_bank_members ON public.buddy_trident_bundles;
CREATE POLICY trident_bundles_select_for_bank_members
  ON public.buddy_trident_bundles FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id = buddy_trident_bundles.bank_id
      AND m.user_id = auth.uid()
  ));

COMMENT ON TABLE public.buddy_trident_bundles IS
  'Trident bundle manifests: business plan + projections + feasibility. mode=preview is borrower-visible (redacted at data layer, watermarked at render); mode=final is released at borrower pick. Partial unique index enforces exactly one current succeeded bundle per (deal, mode).';

-- Storage bucket — private, 50 MB/file. Files accessed only via short-lived
-- signed URLs minted by /api/brokerage/deals/[dealId]/trident/download/[kind].
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('trident-bundles', 'trident-bundles', false, 52428800)
ON CONFLICT (id) DO NOTHING;
