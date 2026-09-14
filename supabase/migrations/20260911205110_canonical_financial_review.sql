-- Server-authorized banker decisions commit facts, gap, conflict and audit together.
-- Additive: existing snapshots remain immutable and no financial history is deleted.
BEGIN;
-- Retire historical output-to-input echoes. Preserve records and explicit banker
-- decisions; these rejected derived rows cannot enter the shared fact selector.
UPDATE public.deal_financial_facts
SET is_superseded = true, resolution_status = 'system_invalidated'
WHERE provenance->>'source_ref' LIKE 'deal_spreads:GLOBAL_CASH_FLOW%'
  AND coalesce(resolution_status,'pending') NOT IN ('confirmed','overridden','provided')
  AND NOT is_superseded;
ALTER TABLE public.financial_review_resolutions DROP CONSTRAINT IF EXISTS financial_review_resolutions_action_check;
ALTER TABLE public.financial_review_resolutions ADD CONSTRAINT financial_review_resolutions_action_check
  CHECK (action IN ('confirm_value','choose_source_value','override_value','provide_value','mark_follow_up','reject_value'));
ALTER TABLE public.financial_review_resolutions DROP CONSTRAINT IF EXISTS financial_review_resolutions_resolved_status_check;
ALTER TABLE public.financial_review_resolutions ADD CONSTRAINT financial_review_resolutions_resolved_status_check
  CHECK (resolved_status IN ('resolved_confirmed','resolved_selected_source','resolved_overridden','resolved_provided','deferred_follow_up','resolved_rejected'));

-- These tables are served through Clerk-authorized server routes, not browser SQL.
ALTER TABLE public.deal_gap_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_fact_conflicts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_review_resolutions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.resolve_canonical_financial_review(
  p_deal_id uuid, p_bank_id uuid, p_gap_id uuid,
  p_actor_user_id text, p_actor_role text, p_intent jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  g public.deal_gap_queue%ROWTYPE;
  f public.deal_financial_facts%ROWTYPE;
  candidate public.deal_financial_facts%ROWTYPE;
  c public.deal_fact_conflicts%ROWTYPE;
  prior_manual public.deal_financial_facts%ROWTYPE;
  action text := p_intent->>'action';
  rationale text := nullif(btrim(p_intent->>'rationale'), '');
  selected_id uuid := (p_intent->>'factId')::uuid;
  value numeric;
  period_start date;
  period_end date;
  owner_id uuid;
  owner_kind text;
  result_id uuid;
  resolved_status text;
  result jsonb;
  stamp timestamptz := now();
  zero_id constant uuid := '00000000-0000-0000-0000-000000000000';
BEGIN
  IF nullif(btrim(p_actor_user_id), '') IS NULL OR nullif(btrim(p_actor_role), '') IS NULL
    OR p_deal_id IS NULL OR p_bank_id IS NULL THEN
    RAISE EXCEPTION 'invalid_review_actor';
  END IF;
  SELECT * INTO g FROM public.deal_gap_queue
    WHERE id = p_gap_id AND deal_id = p_deal_id AND bank_id = p_bank_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'gap_not_found'; END IF;
  IF g.status <> 'open' THEN
    IF g.resolution_meta->'intent' = p_intent AND g.resolved_by = p_actor_user_id
      AND g.resolution_meta->'result' IS NOT NULL THEN
      RETURN g.resolution_meta->'result';
    END IF;
    RAISE EXCEPTION 'review_already_resolved';
  END IF;
  IF action IS NULL OR NOT (
    (g.gap_type = 'low_confidence' AND action IN ('confirm_value','override_value','reject_value','mark_follow_up')) OR
    (g.gap_type = 'conflict' AND action IN ('choose_source_value','override_value','mark_follow_up')) OR
    (g.gap_type = 'missing_fact' AND action IN ('provide_value','mark_follow_up'))
  ) THEN RAISE EXCEPTION 'invalid_review_action'; END IF;
  IF action IN ('override_value','provide_value','reject_value','mark_follow_up')
    AND coalesce(length(rationale),0) < 10 THEN RAISE EXCEPTION 'review_rationale_required'; END IF;
  IF p_intent->>'conflictId' IS NOT NULL
    AND (p_intent->>'conflictId')::uuid IS DISTINCT FROM g.conflict_id THEN
    RAISE EXCEPTION 'conflict_mismatch';
  END IF;

  IF action <> 'mark_follow_up' AND g.gap_type <> 'missing_fact' THEN
    IF g.gap_type = 'conflict' THEN
      SELECT * INTO c FROM public.deal_fact_conflicts
        WHERE id = g.conflict_id AND deal_id = p_deal_id AND bank_id = p_bank_id FOR UPDATE;
      IF NOT FOUND OR c.status <> 'open' OR c.fact_type <> g.fact_type OR c.fact_key <> g.fact_key THEN
        RAISE EXCEPTION 'conflict_not_found';
      END IF;
      selected_id := coalesce(selected_id, g.fact_id);
      IF selected_id IS NULL OR NOT selected_id = ANY(c.conflicting_fact_ids) THEN
        RAISE EXCEPTION 'selected_fact_not_in_conflict';
      END IF;
    ELSE
      IF selected_id IS NOT NULL AND selected_id IS DISTINCT FROM g.fact_id THEN
        RAISE EXCEPTION 'fact_gap_mismatch';
      END IF;
      selected_id := g.fact_id;
    END IF;
    SELECT * INTO f FROM public.deal_financial_facts
      WHERE id = selected_id AND deal_id = p_deal_id AND bank_id = p_bank_id FOR UPDATE;
    IF NOT FOUND OR f.fact_key <> g.fact_key
      OR (g.gap_type = 'conflict' AND f.fact_type <> g.fact_type)
      OR (g.owner_entity_id IS NOT NULL AND coalesce(f.owner_entity_id,zero_id) <> g.owner_entity_id)
      OR f.is_superseded OR coalesce(f.resolution_status,'') IN ('rejected','system_invalidated','superseded') THEN
      RAISE EXCEPTION 'fact_not_reviewable';
    END IF;
    -- Old low-confidence gaps used FINANCIAL and omitted the owner. The linked
    -- canonical fact supplies both; never manufacture identity from a UI label.
    g.fact_type := f.fact_type;
    IF g.gap_type = 'conflict' THEN
      -- Never discard another entity, year, tenant, or metric when selecting a source.
      IF cardinality(c.conflicting_fact_ids) < 2 THEN RAISE EXCEPTION 'invalid_conflict'; END IF;
      FOR candidate IN SELECT * FROM public.deal_financial_facts
        WHERE id = ANY(c.conflicting_fact_ids) ORDER BY id FOR UPDATE LOOP
        IF candidate.deal_id <> p_deal_id OR candidate.bank_id <> p_bank_id
          OR candidate.fact_type <> f.fact_type OR candidate.fact_key <> f.fact_key
          OR candidate.owner_type IS DISTINCT FROM f.owner_type
          OR candidate.owner_entity_id IS DISTINCT FROM f.owner_entity_id
          OR candidate.fact_period_start IS DISTINCT FROM f.fact_period_start
          OR candidate.fact_period_end IS DISTINCT FROM f.fact_period_end
          OR candidate.is_superseded THEN RAISE EXCEPTION 'conflict_identity_mismatch'; END IF;
      END LOOP;
      IF (SELECT count(*) FROM public.deal_financial_facts WHERE id = ANY(c.conflicting_fact_ids))
        <> cardinality(c.conflicting_fact_ids) THEN RAISE EXCEPTION 'conflict_fact_missing'; END IF;
    END IF;
    period_start := f.fact_period_start;
    period_end := f.fact_period_end;
    owner_id := f.owner_entity_id;
    owner_kind := f.owner_type;
    value := f.fact_value_num;
    result_id := f.id;
  END IF;

  IF action IN ('override_value','provide_value') THEN
    IF jsonb_typeof(p_intent->'resolvedValue') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'finite_value_required';
    END IF;
    value := (p_intent->>'resolvedValue')::numeric;
    IF action = 'provide_value' THEN
      period_start := (p_intent->>'resolvedPeriodStart')::date;
      period_end := (p_intent->>'resolvedPeriodEnd')::date;
      owner_id := coalesce(g.owner_entity_id,zero_id);
      -- Missing entity-scoped facts need an explicit owner classification upstream.
      -- Do not silently classify a person as a business.
      IF owner_id <> zero_id THEN RAISE EXCEPTION 'missing_fact_owner_type_required'; END IF;
      owner_kind := 'DEAL';
    ELSE
      IF (p_intent->>'resolvedPeriodStart' IS NOT NULL AND (p_intent->>'resolvedPeriodStart')::date IS DISTINCT FROM period_start)
        OR (p_intent->>'resolvedPeriodEnd' IS NOT NULL AND (p_intent->>'resolvedPeriodEnd')::date IS DISTINCT FROM period_end) THEN
        RAISE EXCEPTION 'override_must_preserve_period';
      END IF;
    END IF;
    IF period_start IS NULL OR period_end IS NULL OR period_start <= '1990-01-01'::date
      OR period_end < period_start THEN RAISE EXCEPTION 'financial_period_required'; END IF;
    SELECT * INTO prior_manual FROM public.deal_financial_facts
      WHERE deal_id = p_deal_id AND bank_id = p_bank_id AND source_document_id = zero_id
        AND fact_type = g.fact_type AND fact_key = g.fact_key AND fact_period_start = period_start
        AND fact_period_end = period_end AND owner_type = owner_kind AND owner_entity_id = owner_id FOR UPDATE;
    INSERT INTO public.deal_financial_facts (
      deal_id,bank_id,source_document_id,fact_type,fact_key,fact_period_start,fact_period_end,
      fact_value_num,confidence,provenance,owner_type,owner_entity_id,fact_identity_hash,resolution_status,is_superseded
    ) VALUES (
      p_deal_id,p_bank_id,zero_id,g.fact_type,g.fact_key,period_start,period_end,
      value,1,jsonb_build_object('source_type','MANUAL','source_ref','financial_review:' || p_gap_id::text,
        'extractor','financial_review','actor_user_id',p_actor_user_id,'reviewed_at',stamp,
        'prior_fact_id',f.id,'engine','financial_review','version','1'),
      owner_kind,owner_id,public.compute_fact_identity_hash(zero_id,g.fact_type,g.fact_key,period_start,period_end,owner_id),
      CASE action WHEN 'override_value' THEN 'overridden' ELSE 'provided' END,false
    ) ON CONFLICT (deal_id,bank_id,fact_identity_hash) WHERE fact_identity_hash IS NOT NULL
    DO UPDATE SET fact_value_num = EXCLUDED.fact_value_num, fact_value_text = NULL,
      confidence = 1, provenance = EXCLUDED.provenance, resolution_status = EXCLUDED.resolution_status,
      is_superseded = false, fact_version = gen_random_uuid()
      WHERE deal_financial_facts.owner_type = EXCLUDED.owner_type
    RETURNING id INTO result_id;
    IF result_id IS NULL THEN RAISE EXCEPTION 'manual_fact_identity_mismatch'; END IF;
    IF f.id IS NOT NULL AND f.id <> result_id THEN
      UPDATE public.deal_financial_facts SET is_superseded = true, resolution_status = 'superseded' WHERE id = f.id;
    END IF;
  ELSIF action IN ('confirm_value','choose_source_value') THEN
    IF value IS NULL OR value::text IN ('NaN','Infinity','-Infinity') THEN RAISE EXCEPTION 'finite_value_required'; END IF;
    UPDATE public.deal_financial_facts SET resolution_status = 'confirmed' WHERE id = result_id;
  ELSIF action = 'reject_value' THEN
    UPDATE public.deal_financial_facts SET resolution_status = 'rejected', is_superseded = true WHERE id = result_id;
  END IF;
  IF g.gap_type = 'conflict' AND action <> 'mark_follow_up' THEN
    UPDATE public.deal_financial_facts SET resolution_status = 'rejected', is_superseded = true
      WHERE id = ANY(c.conflicting_fact_ids) AND id <> result_id;
    UPDATE public.deal_fact_conflicts SET status = 'resolved', resolved_fact_id = result_id,
      resolved_by = p_actor_user_id, resolved_at = stamp, updated_at = stamp WHERE id = c.id;
  END IF;
  resolved_status := CASE action WHEN 'confirm_value' THEN 'resolved_confirmed'
    WHEN 'choose_source_value' THEN 'resolved_selected_source' WHEN 'override_value' THEN 'resolved_overridden'
    WHEN 'provide_value' THEN 'resolved_provided' WHEN 'reject_value' THEN 'resolved_rejected' ELSE 'deferred_follow_up' END;
  result := jsonb_build_object('ok',true,'resolution',jsonb_build_object(
    'gapId',g.id,'factId',result_id,'resolvedStatus',resolved_status,'action',action,
    'resolvedValue',value,'rationale',rationale,'resolvedAt',stamp));
  INSERT INTO public.financial_review_resolutions (
    deal_id,bank_id,gap_id,fact_key,gap_type,action,resolved_status,selected_fact_id,selected_conflict_id,
    prior_value,resolved_value,resolved_period_start,resolved_period_end,rationale,provenance_snapshot,actor_user_id,actor_role
  ) VALUES (p_deal_id,p_bank_id,g.id,g.fact_key,g.gap_type,action,resolved_status,result_id,g.conflict_id,
    f.fact_value_num,value,period_start,period_end,rationale,
    jsonb_build_object('source_fact',to_jsonb(f),'prior_manual_fact',to_jsonb(prior_manual)),p_actor_user_id,p_actor_role);
  UPDATE public.deal_gap_queue SET status = CASE action WHEN 'mark_follow_up' THEN 'deferred' ELSE 'resolved' END,
    resolved_by = p_actor_user_id,resolved_at = stamp,updated_at = stamp,
    resolution_meta = jsonb_build_object('intent',p_intent,'result',result,'action',action,'resolved_status',resolved_status)
    WHERE id = g.id;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_canonical_financial_review(uuid,uuid,uuid,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_canonical_financial_review(uuid,uuid,uuid,text,text,jsonb) TO service_role;
COMMIT;
