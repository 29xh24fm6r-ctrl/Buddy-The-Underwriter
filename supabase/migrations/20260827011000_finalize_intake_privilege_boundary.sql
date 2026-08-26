-- Restrict atomic intake finalization to Buddy's trusted server boundary.
--
-- The RPC is invoked only by the tenant-authorized Next.js route through the
-- service-role client. Browser roles must not be able to bypass that route and
-- submit arbitrary deal, bank, actor, or run identifiers to this SECURITY
-- DEFINER function.

ALTER FUNCTION public.finalize_intake_and_enqueue_processing(
  uuid,
  text,
  uuid,
  text,
  text,
  text,
  integer
) SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.finalize_intake_and_enqueue_processing(
  uuid,
  text,
  uuid,
  text,
  text,
  text,
  integer
) FROM PUBLIC;

REVOKE ALL ON FUNCTION public.finalize_intake_and_enqueue_processing(
  uuid,
  text,
  uuid,
  text,
  text,
  text,
  integer
) FROM anon;

REVOKE ALL ON FUNCTION public.finalize_intake_and_enqueue_processing(
  uuid,
  text,
  uuid,
  text,
  text,
  text,
  integer
) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.finalize_intake_and_enqueue_processing(
  uuid,
  text,
  uuid,
  text,
  text,
  text,
  integer
) TO service_role;
