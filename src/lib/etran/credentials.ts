import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * SPEC S5 B-3 — encrypted per-tenant SBA E-Tran credential storage.
 * Encryption/decryption happens entirely inside the SECURITY DEFINER RPCs
 * (20260605_d_etran_rpc.sql) — `bank_etran_credentials` itself denies all
 * row-level access (RLS `bec_deny`), so plaintext PEM never touches this
 * process except transiently as RPC args/return values. Never logged (see
 * ARC-00 addendum's explicit non-negotiable on this).
 */

export interface EtranCredentials {
  sba_lender_id: string;
  sba_service_center: string;
  client_cert_pem: string;
  client_key_pem: string;
  endpoint_environment: "sandbox" | "production";
}

export async function getEtranCredentials(bankId: string): Promise<EtranCredentials | null> {
  const sb = supabaseAdmin();
  const encryptionKey = process.env.ETRAN_CRED_ENCRYPTION_KEY;
  if (!encryptionKey) {
    throw new Error("ETRAN_CRED_ENCRYPTION_KEY not configured");
  }

  const { data, error } = await sb.rpc("etran_get_credentials_decrypted", {
    p_bank_id: bankId,
    p_encryption_key: encryptionKey,
  });
  if (error || !data || !data[0]) return null;
  return data[0] as EtranCredentials;
}

export async function storeEtranCredentials(args: {
  bankId: string;
  sbaLenderId: string;
  sbaServiceCenter: string;
  clientCertPem: string;
  clientKeyPem: string;
  endpointEnvironment: "sandbox" | "production";
  certExpiresAt: Date | null;
}): Promise<{ ok: true } | { ok: false; reason: "ENCRYPTION_KEY_MISSING" | "DB_UPSERT_FAILED" }> {
  const sb = supabaseAdmin();
  const encryptionKey = process.env.ETRAN_CRED_ENCRYPTION_KEY;
  if (!encryptionKey) return { ok: false, reason: "ENCRYPTION_KEY_MISSING" };

  const { error } = await sb.rpc("etran_upsert_credentials", {
    p_bank_id: args.bankId,
    p_sba_lender_id: args.sbaLenderId,
    p_sba_service_center: args.sbaServiceCenter,
    p_client_cert_pem: args.clientCertPem,
    p_client_key_pem: args.clientKeyPem,
    p_endpoint_environment: args.endpointEnvironment,
    p_cert_expires_at: args.certExpiresAt?.toISOString() ?? null,
    p_encryption_key: encryptionKey,
  });
  // Never include `error` in a thrown message or log line that might
  // include the encryption key or PEM content — Supabase RPC errors here
  // only ever carry constraint/type-mismatch text, never argument values.
  if (error) return { ok: false, reason: "DB_UPSERT_FAILED" };
  return { ok: true };
}
