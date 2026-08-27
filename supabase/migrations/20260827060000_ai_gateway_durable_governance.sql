BEGIN;

-- Durable, cross-instance admission control for AI gateway token budgets.
-- Server-side only: browser roles receive no table or RPC privileges.
CREATE TABLE IF NOT EXISTS public.ai_gateway_daily_budgets (
  usage_day date NOT NULL,
  role text NOT NULL CHECK (role IN (
    'generator', 'verifier', 'structurer', 'interviewer', 'translator',
    'evidence', 'underwriter'
  )),
  tokens_consumed bigint NOT NULL DEFAULT 0 CHECK (tokens_consumed >= 0),
  tokens_reserved bigint NOT NULL DEFAULT 0 CHECK (tokens_reserved >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (usage_day, role)
);

CREATE TABLE IF NOT EXISTS public.ai_gateway_budget_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usage_day date NOT NULL,
  role text NOT NULL,
  reserved_tokens bigint NOT NULL CHECK (reserved_tokens > 0),
  actual_tokens bigint NULL CHECK (actual_tokens IS NULL OR actual_tokens >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  settled_at timestamptz NULL,
  FOREIGN KEY (usage_day, role)
    REFERENCES public.ai_gateway_daily_budgets(usage_day, role)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS ai_gateway_budget_reservations_active_idx
  ON public.ai_gateway_budget_reservations (usage_day, role, expires_at)
  WHERE settled_at IS NULL;

ALTER TABLE public.ai_gateway_daily_budgets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_gateway_budget_reservations ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ai_gateway_daily_budgets
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.ai_gateway_budget_reservations
  FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_gateway_daily_budgets
  TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_gateway_budget_reservations
  TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_ai_gateway_tokens(
  p_role text,
  p_requested_tokens bigint,
  p_daily_budget bigint
)
RETURNS TABLE (
  allowed boolean,
  reservation_id uuid,
  tokens_consumed bigint,
  tokens_reserved bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_day date := (timezone('UTC', now()))::date;
  v_now timestamptz := now();
  v_expired bigint := 0;
  v_consumed bigint := 0;
  v_reserved bigint := 0;
  v_id uuid;
BEGIN
  IF p_role IS NULL OR p_role NOT IN (
    'generator', 'verifier', 'structurer', 'interviewer', 'translator',
    'evidence', 'underwriter'
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
    UPDATE public.ai_gateway_budget_reservations
       SET settled_at = v_now,
           actual_tokens = 0
     WHERE usage_day = v_day
       AND role = p_role
       AND settled_at IS NULL
       AND expires_at <= v_now
    RETURNING reserved_tokens
  )
  SELECT COALESCE(sum(reserved_tokens), 0)::bigint
    INTO v_expired
    FROM released;

  IF v_expired > 0 THEN
    UPDATE public.ai_gateway_daily_budgets
       SET tokens_reserved = greatest(0, tokens_reserved - v_expired),
           updated_at = v_now
     WHERE usage_day = v_day AND role = p_role;
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

  UPDATE public.ai_gateway_daily_budgets
     SET tokens_reserved = tokens_reserved + p_requested_tokens,
         updated_at = v_now
   WHERE usage_day = v_day AND role = p_role
  RETURNING ai_gateway_daily_budgets.tokens_consumed,
            ai_gateway_daily_budgets.tokens_reserved
       INTO v_consumed, v_reserved;

  RETURN QUERY SELECT true, v_id, v_consumed, v_reserved;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_ai_gateway_tokens(
  p_reservation_id uuid,
  p_actual_tokens bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.ai_gateway_budget_reservations%ROWTYPE;
BEGIN
  IF p_reservation_id IS NULL OR p_actual_tokens IS NULL OR p_actual_tokens < 0 THEN
    RAISE EXCEPTION 'reservation id and non-negative actual tokens are required';
  END IF;

  SELECT *
    INTO v_row
    FROM public.ai_gateway_budget_reservations
   WHERE id = p_reservation_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(
      'ai_gateway_budget:' || v_row.role || ':' || v_row.usage_day::text,
      0
    )
  );

  SELECT *
    INTO v_row
    FROM public.ai_gateway_budget_reservations
   WHERE id = p_reservation_id
   FOR UPDATE;

  IF v_row.settled_at IS NOT NULL THEN
    RETURN true;
  END IF;

  UPDATE public.ai_gateway_daily_budgets
     SET tokens_reserved = greatest(0, tokens_reserved - v_row.reserved_tokens),
         tokens_consumed = tokens_consumed + p_actual_tokens,
         updated_at = now()
   WHERE usage_day = v_row.usage_day AND role = v_row.role;

  UPDATE public.ai_gateway_budget_reservations
     SET actual_tokens = p_actual_tokens,
         settled_at = now()
   WHERE id = p_reservation_id;

  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reserve_ai_gateway_tokens(text, bigint, bigint)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.settle_ai_gateway_tokens(uuid, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ai_gateway_tokens(text, bigint, bigint)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_ai_gateway_tokens(uuid, bigint)
  TO service_role;

COMMENT ON TABLE public.ai_gateway_daily_budgets IS
  'Durable UTC-day AI gateway token consumption and active reservations by role.';
COMMENT ON TABLE public.ai_gateway_budget_reservations IS
  'Idempotent cross-instance reservations that prevent concurrent provider calls from exceeding a role budget.';
COMMENT ON FUNCTION public.reserve_ai_gateway_tokens(text, bigint, bigint) IS
  'Service-role-only atomic AI token admission; releases expired reservations and returns a reservation id when allowed.';
COMMENT ON FUNCTION public.settle_ai_gateway_tokens(uuid, bigint) IS
  'Service-role-only idempotent settlement of one AI token reservation.';

COMMIT;
