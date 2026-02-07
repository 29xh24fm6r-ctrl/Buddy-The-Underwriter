-- =========================================================
-- Fix B: AI → checklist propagation backfill + ON CONFLICT fix
--
-- Root cause: matches created BEFORE the 20260201 auto-apply
-- fix never had their checklist items updated. Also, the
-- ON CONFLICT clause didn't update match status, so re-runs
-- of already-matched artifacts didn't trigger auto-apply.
--
-- Two-part fix:
-- 1. Update create_checklist_match() ON CONFLICT to upgrade status
-- 2. Backfill: apply all existing auto_applied matches to checklist
-- =========================================================

BEGIN;

-- Part 1: Fix the RPC — ON CONFLICT now upgrades status to auto_applied
CREATE OR REPLACE FUNCTION public.create_checklist_match(
  p_deal_id uuid,
  p_bank_id uuid,
  p_artifact_id uuid,
  p_checklist_key text,
  p_confidence numeric,
  p_reason text,
  p_match_source text,
  p_tax_year int default null,
  p_auto_apply boolean default false
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_match_id uuid;
  v_checklist_item_id uuid;
  v_status text;
  v_source_document_id uuid;
BEGIN
  -- Find corresponding checklist item if it exists
  SELECT id INTO v_checklist_item_id
  FROM public.deal_checklist_items
  WHERE deal_id = p_deal_id AND checklist_key = p_checklist_key
  LIMIT 1;

  -- Determine status based on confidence and auto_apply flag
  IF p_auto_apply AND p_confidence >= 0.85 THEN
    v_status := 'auto_applied';
  ELSE
    v_status := 'proposed';
  END IF;

  INSERT INTO public.checklist_item_matches (
    deal_id, bank_id, artifact_id, checklist_item_id,
    checklist_key, confidence, reason, match_source,
    tax_year, status
  )
  VALUES (
    p_deal_id, p_bank_id, p_artifact_id, v_checklist_item_id,
    p_checklist_key, p_confidence, p_reason, p_match_source,
    p_tax_year, v_status
  )
  ON CONFLICT (artifact_id, checklist_key, tax_year)
  DO UPDATE SET
    confidence = excluded.confidence,
    reason     = excluded.reason,
    -- Upgrade status to auto_applied if new confidence qualifies; never downgrade
    status     = CASE
                   WHEN excluded.status = 'auto_applied' THEN 'auto_applied'
                   ELSE checklist_item_matches.status
                 END,
    updated_at = now()
  RETURNING id INTO v_match_id;

  -- =========================================================
  -- Apply auto-applied match to canonical checklist row
  -- =========================================================
  IF v_status = 'auto_applied' THEN
    IF v_checklist_item_id IS NULL THEN
      RAISE NOTICE 'create_checklist_match: auto_applied but no checklist item found for deal_id=%, checklist_key=%',
        p_deal_id, p_checklist_key;
    ELSE
      -- Look up the source deal_documents.id from the artifact
      SELECT source_id INTO v_source_document_id
      FROM public.document_artifacts
      WHERE id = p_artifact_id
        AND source_table = 'deal_documents';

      -- Monotonic upgrade: only transition missing -> received
      UPDATE public.deal_checklist_items
      SET
        status        = 'received',
        received_at   = now(),
        received_document_id = coalesce(v_source_document_id, received_document_id)
      WHERE deal_id       = p_deal_id
        AND checklist_key = p_checklist_key
        AND status        = 'missing';
    END IF;
  END IF;

  RETURN v_match_id;
END;
$$;

-- Part 2: Backfill — apply existing auto_applied matches that were
-- created before the fix and left checklist items stuck at 'missing'
UPDATE public.deal_checklist_items dci
SET
  status      = 'received',
  received_at = COALESCE(dci.received_at, now()),
  received_document_id = COALESCE(
    dci.received_document_id,
    (
      SELECT da.source_id
      FROM public.checklist_item_matches cim2
      JOIN public.document_artifacts da ON da.id = cim2.artifact_id AND da.source_table = 'deal_documents'
      WHERE cim2.deal_id = dci.deal_id
        AND cim2.checklist_key = dci.checklist_key
        AND cim2.status = 'auto_applied'
        AND cim2.confidence >= 0.85
      ORDER BY cim2.confidence DESC
      LIMIT 1
    )
  )
FROM public.checklist_item_matches cim
WHERE cim.deal_id       = dci.deal_id
  AND cim.checklist_key = dci.checklist_key
  AND cim.status        = 'auto_applied'
  AND cim.confidence    >= 0.85
  AND dci.status        = 'missing';

COMMIT;
