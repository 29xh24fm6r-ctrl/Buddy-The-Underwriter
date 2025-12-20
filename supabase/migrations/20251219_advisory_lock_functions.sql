-- 20251219_advisory_lock_functions.sql
-- PostgreSQL advisory lock wrappers for idempotency guards

-- Try to acquire a lock (returns true if acquired, false if already held)
CREATE OR REPLACE FUNCTION pg_try_advisory_lock(lock_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN pg_try_advisory_lock(lock_id);
END;
$$;

-- Release a lock
CREATE OR REPLACE FUNCTION pg_advisory_unlock(lock_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN pg_advisory_unlock(lock_id);
END;
$$;

-- Grant execute to service_role
GRANT EXECUTE ON FUNCTION pg_try_advisory_lock(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION pg_advisory_unlock(bigint) TO service_role;
