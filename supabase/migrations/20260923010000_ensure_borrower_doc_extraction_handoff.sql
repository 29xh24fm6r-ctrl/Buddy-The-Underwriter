-- Keep a borrower retry's artifact state and durable extraction trigger in one
-- transaction.  The extraction worker consumes buddy_outbox_events, so a
-- queued document_artifacts row without a live doc.extract event is orphaned.

CREATE OR REPLACE FUNCTION public.ensure_borrower_doc_extraction_handoff(
  p_deal_id uuid,
  p_bank_id uuid,
  p_document_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_artifact_id uuid;
  v_artifact_status text;
  v_outbox_id uuid;
  v_outbox_created boolean := false;
BEGIN
  -- The row lock serializes retries for the same document.  That makes the
  -- live-event check and insert idempotent without a race between two clicks.
  SELECT id, status
  INTO v_artifact_id, v_artifact_status
  FROM public.document_artifacts
  WHERE deal_id = p_deal_id
    AND bank_id = p_bank_id
    AND source_table = 'deal_documents'
    AND source_id = p_document_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document artifact is not available for extraction';
  END IF;

  IF v_artifact_status NOT IN ('queued', 'classified', 'routed_to_review', 'failed') THEN
    RAISE EXCEPTION 'Document artifact cannot be queued from status %', v_artifact_status;
  END IF;

  UPDATE public.document_artifacts
  SET status = 'queued', updated_at = now()
  WHERE id = v_artifact_id;

  SELECT id
  INTO v_outbox_id
  FROM public.buddy_outbox_events
  WHERE kind = 'doc.extract'
    AND deal_id = p_deal_id
    AND bank_id = p_bank_id
    AND payload ->> 'doc_id' = p_document_id::text
    AND delivered_at IS NULL
    AND dead_lettered_at IS NULL
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_outbox_id IS NULL THEN
    INSERT INTO public.buddy_outbox_events (
      kind,
      deal_id,
      bank_id,
      source,
      payload
    )
    VALUES (
      'doc.extract',
      p_deal_id,
      p_bank_id,
      'borrower_retry',
      jsonb_build_object(
        'doc_id', p_document_id,
        'deal_id', p_deal_id,
        'bank_id', p_bank_id,
        'intake_run_id', NULL,
        'doc_type', NULL,
        'force_refresh', false
      )
    )
    RETURNING id INTO v_outbox_id;

    v_outbox_created := true;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'artifact_id', v_artifact_id,
    'outbox_id', v_outbox_id,
    'outbox_created', v_outbox_created
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_borrower_doc_extraction_handoff(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_borrower_doc_extraction_handoff(uuid, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.ensure_borrower_doc_extraction_handoff(uuid, uuid, uuid) IS
  'Atomically queues a borrower document artifact and ensures one live doc.extract outbox event.';
