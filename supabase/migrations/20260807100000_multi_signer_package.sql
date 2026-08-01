-- §5: Multi-signer package completeness
-- Add ownership_entity_id to sba_package_run_items and fill_runs so
-- per-owner forms (413, 912, 4506-C, 148, 148L) can have one row per
-- (template_code, owner) instead of one row per template_code.

ALTER TABLE public.sba_package_run_items
  ADD COLUMN IF NOT EXISTS ownership_entity_id uuid NULL
    REFERENCES public.ownership_entities(id);

CREATE INDEX IF NOT EXISTS idx_sba_pkg_run_items_owner
  ON public.sba_package_run_items(ownership_entity_id)
  WHERE ownership_entity_id IS NOT NULL;

ALTER TABLE public.fill_runs
  ADD COLUMN IF NOT EXISTS ownership_entity_id uuid NULL;
