-- ARC-00 Phase 6 (SPEC S5) B-2 — AP-3 finding: pgcrypto's functions live
-- in the `extensions` schema on this Supabase project (standard Supabase
-- convention), not `public`. The spec's `SET search_path = public` alone
-- can't resolve pgp_sym_encrypt/pgp_sym_decrypt — confirmed via
-- `pg_proc`/`pg_namespace` before fixing. Both RPCs' search_path now
-- includes `extensions`.
BEGIN;

CREATE OR REPLACE FUNCTION public.etran_upsert_credentials(
  p_bank_id uuid,
  p_sba_lender_id text,
  p_sba_service_center text,
  p_client_cert_pem text,
  p_client_key_pem text,
  p_endpoint_environment text,
  p_cert_expires_at timestamptz,
  p_encryption_key text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  INSERT INTO public.bank_etran_credentials (
    bank_id, sba_lender_id, sba_service_center,
    client_cert_pem_encrypted, client_key_pem_encrypted,
    endpoint_environment, cert_expires_at, last_rotation_at
  ) VALUES (
    p_bank_id, p_sba_lender_id, p_sba_service_center,
    pgp_sym_encrypt(p_client_cert_pem, p_encryption_key),
    pgp_sym_encrypt(p_client_key_pem, p_encryption_key),
    p_endpoint_environment, p_cert_expires_at, now()
  )
  ON CONFLICT (bank_id) DO UPDATE SET
    sba_lender_id = EXCLUDED.sba_lender_id,
    sba_service_center = EXCLUDED.sba_service_center,
    client_cert_pem_encrypted = EXCLUDED.client_cert_pem_encrypted,
    client_key_pem_encrypted = EXCLUDED.client_key_pem_encrypted,
    endpoint_environment = EXCLUDED.endpoint_environment,
    cert_expires_at = EXCLUDED.cert_expires_at,
    last_rotation_at = now();
END $$;

CREATE OR REPLACE FUNCTION public.etran_get_credentials_decrypted(
  p_bank_id uuid,
  p_encryption_key text
) RETURNS TABLE (
  sba_lender_id text,
  sba_service_center text,
  client_cert_pem text,
  client_key_pem text,
  endpoint_environment text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public, extensions AS $$
  SELECT
    sba_lender_id,
    sba_service_center,
    pgp_sym_decrypt(client_cert_pem_encrypted, p_encryption_key)::text AS client_cert_pem,
    pgp_sym_decrypt(client_key_pem_encrypted, p_encryption_key)::text AS client_key_pem,
    endpoint_environment
  FROM public.bank_etran_credentials
  WHERE bank_id = p_bank_id;
$$;

REVOKE EXECUTE ON FUNCTION public.etran_upsert_credentials(uuid, text, text, text, text, text, timestamptz, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.etran_get_credentials_decrypted(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.etran_upsert_credentials(uuid, text, text, text, text, text, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.etran_get_credentials_decrypted(uuid, text) TO service_role;

COMMIT;
