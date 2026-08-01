-- §5: Multi-signer package completeness
-- Add ownership_entity_id to sba_package_run_items so per-owner forms
-- (413, 912, 4506-C, 148, 148L) can have one row per
-- (template_code, owner) instead of one row per template_code.
--
-- REMOVED (audit 2026-08-01): this migration originally also contained
--
--   ALTER TABLE public.fill_runs
--     ADD COLUMN IF NOT EXISTS ownership_entity_id uuid NULL;
--
-- public.fill_runs has never existed in this database.
-- 20251218000013_sba_package_builder.sql created
-- sba_package_run_items.fill_run_id as a bare `uuid null` with NO foreign
-- key and never created the referenced table; no later migration did
-- either, and it is absent from both schema-reap batches
-- (20260729030000 / 20260729040000) — it was never dropped, it was never
-- created.
--
-- `ADD COLUMN IF NOT EXISTS` guards the column, not the table, so that
-- statement raised 42P01 and — because migrations run in a transaction —
-- rolled back this entire file, meaning the sba_package_run_items column
-- below never landed either.
--
-- Nothing reads fill_run_id (assembleTenTabPackage.ts selects
-- output_storage_path), so the correct remedy is removing the phantom
-- insert in buildPackage.ts, not manufacturing the table. See that file's
-- header comment.
--
-- Applied to production 2026-08-01 as migration
-- `multi_signer_package_run_items`; this file is kept in sync so fresh
-- environments and CI databases converge on the same schema.

ALTER TABLE public.sba_package_run_items
  ADD COLUMN IF NOT EXISTS ownership_entity_id uuid NULL
    REFERENCES public.ownership_entities(id);

CREATE INDEX IF NOT EXISTS idx_sba_pkg_run_items_owner
  ON public.sba_package_run_items(ownership_entity_id)
  WHERE ownership_entity_id IS NOT NULL;
