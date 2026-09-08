-- PR #1039 introduced two gateway roles ("extractor" for OCR and structured
-- document extraction, "research" for grounded BIE research) so that neither
-- workload can starve the other or the generator pool. The durable governance
-- layer enumerates roles in three places; all three rejected the new roles,
-- so every OCR and research call failed closed with
-- "AI budget reservation failed: invalid AI gateway role".
BEGIN;

ALTER TABLE public.ai_gateway_calls
  DROP CONSTRAINT IF EXISTS ai_gateway_calls_role_check;
ALTER TABLE public.ai_gateway_calls
  ADD CONSTRAINT ai_gateway_calls_role_check
  CHECK (role IN (
    'generator', 'extractor', 'research', 'verifier', 'structurer',
    'interviewer', 'translator', 'embedder', 'evidence', 'underwriter'
  ));

ALTER TABLE public.ai_gateway_daily_budgets
  DROP CONSTRAINT IF EXISTS ai_gateway_daily_budgets_role_check;
ALTER TABLE public.ai_gateway_daily_budgets
  ADD CONSTRAINT ai_gateway_daily_budgets_role_check
  CHECK (role IN (
    'generator', 'extractor', 'research', 'verifier', 'structurer',
    'interviewer', 'translator', 'embedder', 'evidence', 'underwriter'
  ));

CREATE OR REPLACE FUNCTION public.reserve_ai_gateway_tokens(
  p_role text,
  p_requested_tokens bigint,
  p_daily_budget bigint
)
RETURNS TABLE(allowed boolean, reservation_id uuid, tokens_consumed bigint, tokens_reserved bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_day date := (timezone('UTC', now()))::date;
  v_now timestamptz := now();
  v_expired bigint := 0;
  v_consumed bigint := 0;
  v_reserved bigint := 0;
  v_id uuid;
BEGIN
  IF p_role IS NULL OR p_role NOT IN (
    'generator', 'extractor', 'research', 'verifier', 'structurer',
    'interviewer', 'translator', 'evidence', 'underwriter', 'embedder'
  ) THEN
    RAISE EXCEPTION 'invalid AI gateway role';
  END IF;
  IF p_requested_tokens IS NULL OR p_requested_tokens <= 0
     OR p_daily_budget IS NULL OR p_daily_budget <= 0 THEN
    RAISE EXCEPTION 'token reservation and daily budget must be positive';
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended('ai_gateway_budget:' || p_role || ':' || v_day::text, 0)
  );

  INSERT INTO public.ai_gateway_daily_budgets (usage_day, role)
  VALUES (v_day, p_role)
  ON CONFLICT (usage_day, role) DO NOTHING;

  WITH released AS (
    UPDATE public.ai_gateway_budget_reservations AS r
       SET settled_at = v_now,
           actual_tokens = r.reserved_tokens
     WHERE r.usage_day = v_day
       AND r.role = p_role
       AND r.settled_at IS NULL
       AND r.expires_at <= v_now
    RETURNING r.reserved_tokens
  )
  SELECT COALESCE(sum(released.reserved_tokens), 0)::bigint
    INTO v_expired
    FROM released;

  IF v_expired > 0 THEN
    UPDATE public.ai_gateway_daily_budgets AS b
       SET tokens_reserved = greatest(0, b.tokens_reserved - v_expired),
           tokens_consumed = b.tokens_consumed + v_expired,
           updated_at = v_now
     WHERE b.usage_day = v_day AND b.role = p_role;
  END IF;

  SELECT b.tokens_consumed, b.tokens_reserved
    INTO v_consumed, v_reserved
    FROM public.ai_gateway_daily_budgets b
   WHERE b.usage_day = v_day AND b.role = p_role
   FOR UPDATE;

  IF v_consumed + v_reserved + p_requested_tokens > p_daily_budget THEN
    RETURN QUERY SELECT false, NULL::uuid, v_consumed, v_reserved;
    RETURN;
  END IF;

  INSERT INTO public.ai_gateway_budget_reservations (
    usage_day, role, reserved_tokens, expires_at
  )
  VALUES (v_day, p_role, p_requested_tokens, v_now + interval '10 minutes')
  RETURNING id INTO v_id;

  UPDATE public.ai_gateway_daily_budgets AS b
     SET tokens_reserved = b.tokens_reserved + p_requested_tokens,
         updated_at = v_now
   WHERE b.usage_day = v_day AND b.role = p_role
  RETURNING b.tokens_consumed, b.tokens_reserved
       INTO v_consumed, v_reserved;

  RETURN QUERY SELECT true, v_id, v_consumed, v_reserved;
END;
$function$;

COMMIT;
