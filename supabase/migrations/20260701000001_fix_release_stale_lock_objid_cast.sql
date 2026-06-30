-- SPEC-LOCKJANITOR-RPC-TYPEFIX-1
-- release_stale_worker_advisory_locks returned pg_locks.objid (type oid) into a
-- bigint column. oid is not binary-coercible to bigint, so plpgsql RETURN QUERY
-- threw "structure of query does not match function result type" on every call.
-- Fix: cast l.objid::bigint. Signature, security, search_path, and WHERE clause
-- are otherwise unchanged from 20260701000000_worker_advisory_xact_lock.sql.

CREATE OR REPLACE FUNCTION public.release_stale_worker_advisory_locks(
  p_idle_threshold_seconds integer DEFAULT 300
)
 RETURNS TABLE(terminated_pid integer, released_lock_key bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    a.pid              AS terminated_pid,
    l.objid::bigint    AS released_lock_key
  FROM pg_locks l
  JOIN pg_stat_activity a ON l.pid = a.pid
  WHERE l.locktype = 'advisory'
    AND l.objid BETWEEN 42001001 AND 42001005
    AND a.application_name = 'postgrest'
    AND a.state = 'idle'
    AND EXTRACT(EPOCH FROM (now() - a.state_change)) > p_idle_threshold_seconds
    AND pg_terminate_backend(a.pid);
END;
$function$;
