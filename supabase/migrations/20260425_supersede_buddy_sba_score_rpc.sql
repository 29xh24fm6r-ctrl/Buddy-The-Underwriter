-- Transactional "mark-current-superseded + insert-new" for buddy_sba_scores.
-- Partial unique index guarantees only one current row per deal; this RPC
-- makes the transition atomic so racing computes never both insert.

CREATE OR REPLACE FUNCTION public.supersede_and_insert_buddy_sba_score(
  p_deal_id uuid,
  p_bank_id uuid,
  p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_id uuid;
BEGIN
  UPDATE public.buddy_sba_scores
     SET superseded_at = now(),
         score_status = 'superseded'
   WHERE deal_id = p_deal_id
     AND superseded_at IS NULL;

  INSERT INTO public.buddy_sba_scores (
    deal_id, bank_id,
    score_version, score_status,
    eligibility_passed, eligibility_failures,
    score, band, rate_card_tier,
    borrower_strength, business_strength, deal_structure,
    repayment_capacity, franchise_quality,
    narrative, top_strengths, top_weaknesses,
    input_snapshot, weights_snapshot, computation_context
  )
  VALUES (
    p_deal_id, p_bank_id,
    p_payload->>'score_version',
    COALESCE(p_payload->>'score_status', 'draft'),
    (p_payload->>'eligibility_passed')::boolean,
    COALESCE(p_payload->'eligibility_failures', '[]'::jsonb),
    (p_payload->>'score')::integer,
    p_payload->>'band',
    p_payload->>'rate_card_tier',
    p_payload->'borrower_strength',
    p_payload->'business_strength',
    p_payload->'deal_structure',
    p_payload->'repayment_capacity',
    p_payload->'franchise_quality',
    p_payload->>'narrative',
    COALESCE(p_payload->'top_strengths',  '[]'::jsonb),
    COALESCE(p_payload->'top_weaknesses', '[]'::jsonb),
    p_payload->'input_snapshot',
    p_payload->'weights_snapshot',
    COALESCE(p_payload->>'computation_context', 'manual')
  )
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

-- Lock a draft score (called at package seal time — Sprint 5).
CREATE OR REPLACE FUNCTION public.lock_buddy_sba_score(p_deal_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  UPDATE public.buddy_sba_scores
     SET score_status = 'locked',
         locked_at = now()
   WHERE deal_id = p_deal_id
     AND superseded_at IS NULL
     AND score_status = 'draft'
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.supersede_and_insert_buddy_sba_score(uuid, uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lock_buddy_sba_score(uuid) TO authenticated, service_role;
