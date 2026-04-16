-- Phase 82: Joint Filer Entity Binding
--
-- Adds subject_ids (UUID array) to deal_documents so a single document
-- (joint 1040 MFJ, joint PFS) can be bound to multiple guarantor entities.
--
-- Backward compat: assigned_owner_id (single UUID) is preserved unchanged.
-- All existing code continues working. New joint-binding code writes subject_ids.
-- When subject_ids is populated, it takes precedence over assigned_owner_id for
-- joint satisfaction checks.

-- Step 1: Add subject_ids array column (nullable, preserves existing rows)
ALTER TABLE public.deal_documents
  ADD COLUMN IF NOT EXISTS subject_ids UUID[] DEFAULT NULL;

-- Step 2: Add joint filer metadata columns
ALTER TABLE public.deal_documents
  ADD COLUMN IF NOT EXISTS joint_filer_confirmed BOOLEAN DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS joint_filer_confirmed_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS joint_filer_confirmed_by TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS joint_filer_detection_source TEXT DEFAULT NULL;
  -- joint_filer_detection_source values:
  -- "auto_mfj"       — detected MFJ checkbox on Form 1040
  -- "auto_joint_pfs" — detected two signatories on PFS
  -- "banker_confirmed" — banker explicitly confirmed via intake UI
  -- "banker_denied"    — banker explicitly denied via intake UI

-- Step 3: Backfill subject_ids from assigned_owner_id for existing single-entity docs
UPDATE public.deal_documents
SET subject_ids = ARRAY[assigned_owner_id]
WHERE assigned_owner_id IS NOT NULL
  AND subject_ids IS NULL;

-- Step 4: Index for efficient entity-based queries
CREATE INDEX IF NOT EXISTS idx_deal_documents_subject_ids
  ON public.deal_documents USING GIN (subject_ids)
  WHERE subject_ids IS NOT NULL;

-- Step 5: Convenience view for joint document queries
CREATE OR REPLACE VIEW public.deal_documents_with_entities AS
SELECT
  dd.*,
  -- Canonical entity ID: subject_ids[1] if joint, else assigned_owner_id
  COALESCE(subject_ids[1], assigned_owner_id) AS primary_subject_id,
  -- Is this a joint document?
  (array_length(subject_ids, 1) > 1 OR joint_filer_confirmed = true) AS is_joint_document,
  -- Count of bound entities
  COALESCE(array_length(subject_ids, 1), CASE WHEN assigned_owner_id IS NOT NULL THEN 1 ELSE 0 END) AS entity_count
FROM public.deal_documents dd;

-- Grant access
GRANT SELECT ON public.deal_documents_with_entities TO authenticated;
GRANT SELECT ON public.deal_documents_with_entities TO service_role;
