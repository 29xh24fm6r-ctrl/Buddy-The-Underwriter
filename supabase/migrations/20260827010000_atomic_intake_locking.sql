-- Buddy SBA intake reliability factory
-- Keep document locking, finalization, outbox creation, and deal transition in
-- one transaction. A count mismatch fails closed when the active set changes
-- between the application gate check and this RPC.

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
  v_locked_count int := 0;
  v_stamped_ids uuid[];
  v_stamped_count int;
BEGIN
  UPDATE deal_documents
  SET
    intake_status = 'LOCKED_FOR_PROCESSING',
    intake_locked_at = v_now
  WHERE deal_id = p_deal_id
    AND is_active = true;

  GET DIAGNOSTICS v_locked_count = ROW_COUNT;

  IF v_locked_count <> p_docs_locked THEN
    RAISE EXCEPTION
      'Active document set changed during confirmation for deal % (expected %, found %)',
      p_deal_id, p_docs_locked, v_locked_count;
  END IF;

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

  v_stamped_ids := COALESCE(v_stamped_ids, ARRAY[]::uuid[]);
  v_stamped_count := COALESCE(v_stamped_count, 0);

  PERFORM reconcile_checklist_for_deal_sql(p_deal_id);

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
      'docs_locked', v_locked_count
    ),
    'buddy'
  );

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

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deal not found during intake finalization: %', p_deal_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'deal_id', p_deal_id,
    'run_id', p_run_id,
    'locked_doc_count', v_locked_count,
    'stamped_doc_count', v_stamped_count,
    'stamped_doc_ids', to_jsonb(v_stamped_ids),
    'finalized_at', v_now
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.finalize_intake_and_enqueue_processing TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_intake_and_enqueue_processing TO service_role;
