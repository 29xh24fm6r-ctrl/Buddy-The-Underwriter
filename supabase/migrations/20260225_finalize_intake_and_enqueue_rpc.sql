-- RPC: finalize_intake_and_enqueue_processing
--
-- Single-transaction atomic function that:
-- 1. Stamps all deal_documents: quality_status='PASSED', finalized_at=now()  (idempotent)
-- 2. Inserts intake.documents_finalized event into deal_events
-- 3. Inserts intake.process outbox row into buddy_outbox_events
-- 4. Transitions deal to CONFIRMED_READY_FOR_PROCESSING + stamps run markers
--
-- INVARIANT: No partial state. Either all 4 steps succeed or none do.
-- Fail-closed: any error rolls back the entire transaction.

CREATE OR REPLACE FUNCTION public.finalize_intake_and_enqueue_processing(
  p_deal_id uuid,
  p_run_id text,
  p_bank_id uuid DEFAULT NULL,
  p_snapshot_hash text DEFAULT NULL,
  p_snapshot_version text DEFAULT 'snapshot_v1',
  p_confirmed_by text DEFAULT NULL,
  p_docs_locked int DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_stamped_ids uuid[];
  v_stamped_count int;
  v_result jsonb;
BEGIN
  -- ── Step 1: Stamp quality_status + finalized_at on ALL active docs ────
  -- Idempotent: only touches docs where finalized_at IS NULL.
  WITH stamped AS (
    UPDATE deal_documents
    SET
      quality_status = 'PASSED',
      finalized_at = v_now
    WHERE deal_id = p_deal_id
      AND is_active = true
      AND finalized_at IS NULL
    RETURNING id
  )
  SELECT array_agg(id), count(*)
  INTO v_stamped_ids, v_stamped_count
  FROM stamped;

  -- Normalize null array to empty
  v_stamped_ids := COALESCE(v_stamped_ids, ARRAY[]::uuid[]);
  v_stamped_count := COALESCE(v_stamped_count, 0);

  -- ── Step 2: Emit intake.documents_finalized event ─────────────────────
  IF v_stamped_count > 0 THEN
    INSERT INTO deal_events (deal_id, kind, payload)
    VALUES (
      p_deal_id,
      'intake.documents_finalized',
      jsonb_build_object(
        'scope', 'intake',
        'action', 'documents_finalized',
        'meta', jsonb_build_object(
          'doc_ids', to_jsonb(v_stamped_ids),
          'count', v_stamped_count,
          'finalized_at', v_now,
          'quality_status', 'PASSED',
          'confirmed_by', p_confirmed_by
        )
      )
    );
  END IF;

  -- ── Step 3: Insert outbox row (durable processing trigger) ────────────
  INSERT INTO buddy_outbox_events (kind, deal_id, bank_id, payload, source)
  VALUES (
    'intake.process',
    p_deal_id,
    p_bank_id,
    jsonb_build_object(
      'deal_id', p_deal_id,
      'run_id', p_run_id,
      'reason', 'confirm_all',
      'snapshot_hash', p_snapshot_hash,
      'docs_locked', p_docs_locked
    ),
    'buddy'
  );

  -- ── Step 4: Transition deal + stamp run markers ───────────────────────
  UPDATE deals
  SET
    intake_phase = 'CONFIRMED_READY_FOR_PROCESSING',
    intake_snapshot_hash = p_snapshot_hash,
    intake_snapshot_version = p_snapshot_version,
    intake_processing_queued_at = v_now,
    intake_processing_started_at = NULL,
    intake_processing_run_id = p_run_id,
    intake_processing_last_heartbeat_at = NULL,
    intake_processing_error = NULL
  WHERE id = p_deal_id;

  -- ── Return summary ────────────────────────────────────────────────────
  v_result := jsonb_build_object(
    'ok', true,
    'deal_id', p_deal_id,
    'run_id', p_run_id,
    'stamped_doc_count', v_stamped_count,
    'stamped_doc_ids', to_jsonb(v_stamped_ids),
    'finalized_at', v_now
  );

  RETURN v_result;
END;
$$;

-- Grant execute to authenticated and service_role
GRANT EXECUTE ON FUNCTION public.finalize_intake_and_enqueue_processing TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_intake_and_enqueue_processing TO service_role;
