CREATE TABLE IF NOT EXISTS public.rate_limit_counters (
  key text PRIMARY KEY,
  count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS rate_limit_counters_expires_at_idx
  ON public.rate_limit_counters (expires_at);

CREATE OR REPLACE FUNCTION public.increment_rate_counter(
  p_key text,
  p_expires_at timestamptz
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.rate_limit_counters (key, count, expires_at)
  VALUES (p_key, 1, p_expires_at)
  ON CONFLICT (key) DO UPDATE SET count = rate_limit_counters.count + 1
  RETURNING count INTO v_count;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.increment_rate_counter(text, timestamptz) TO authenticated, service_role;
