-- Slice 2B: multi-source FDD expansion. Each new source gets its own
-- `_searched_at` column on `franchise_brands` so the orchestrator can
-- resume cleanly per-source — same pattern as the existing
-- `wi_dfi_searched_at` column used by the Wisconsin DFI scraper.
--
-- Adding all four columns now (MN, IN, NASAA, CA) so subsequent slices
-- (2B-2..2B-4) don't need additional migrations.

ALTER TABLE public.franchise_brands
  ADD COLUMN IF NOT EXISTS mn_cards_searched_at timestamptz,
  ADD COLUMN IF NOT EXISTS in_sos_searched_at timestamptz,
  ADD COLUMN IF NOT EXISTS nasaa_efd_searched_at timestamptz,
  ADD COLUMN IF NOT EXISTS ca_dfpi_searched_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_franchise_brands_mn_unsearched
  ON public.franchise_brands(brand_name)
  WHERE mn_cards_searched_at IS NULL AND canonical = true AND sba_eligible = true;

CREATE INDEX IF NOT EXISTS idx_franchise_brands_in_unsearched
  ON public.franchise_brands(brand_name)
  WHERE in_sos_searched_at IS NULL AND canonical = true AND sba_eligible = true;

CREATE INDEX IF NOT EXISTS idx_franchise_brands_nasaa_unsearched
  ON public.franchise_brands(brand_name)
  WHERE nasaa_efd_searched_at IS NULL AND canonical = true AND sba_eligible = true;

CREATE INDEX IF NOT EXISTS idx_franchise_brands_ca_unsearched
  ON public.franchise_brands(brand_name)
  WHERE ca_dfpi_searched_at IS NULL AND canonical = true AND sba_eligible = true;
