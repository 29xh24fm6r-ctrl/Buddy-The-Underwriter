import "server-only";
import { createHash } from "node:crypto";
import { decodeProtectedHeader, importJWK, jwtVerify } from "jose";
import { getPlaidClient } from "@/lib/integrations/plaid/client";

/**
 * Plaid webhook signature verification — JWT-based pattern documented at
 * https://plaid.com/docs/api/webhooks/webhook-verification/ :
 *
 *   1. The `Plaid-Verification` header carries a JWT signed with a key
 *      Plaid rotates; the JWT header's `kid` identifies which key.
 *   2. Fetch that key via /webhook_verification_key/get (cached by kid —
 *      Plaid keys are stable for a period, re-fetching every request is
 *      wasteful and rate-limit-risky).
 *   3. Verify the JWT (ES256) against that JWK.
 *   4. The verified payload's `request_body_sha256` must equal the SHA-256
 *      of the raw (unparsed) request body — this is what actually binds
 *      the signature to this specific payload.
 */

const keyCache = new Map<string, { key: any; fetchedAt: number }>();
const KEY_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — Plaid keys are long-lived

async function getVerificationKey(keyId: string) {
  const cached = keyCache.get(keyId);
  if (cached && Date.now() - cached.fetchedAt < KEY_CACHE_TTL_MS) {
    return cached.key;
  }

  // `webhookVerificationKeyGet` does not type-resolve on the `PlaidApi`
  // class under this project's module resolution (same unresolved-type
  // quirk noted in sync.ts for other Plaid response interfaces) despite
  // being a real, documented SDK method — bridge with a minimal local
  // interface for just this call rather than losing type safety on the
  // parts we do control.
  const client = getPlaidClient() as unknown as {
    webhookVerificationKeyGet: (req: { key_id: string }) => Promise<{ data: { key: Record<string, unknown> } }>;
  };
  const response = await client.webhookVerificationKeyGet({ key_id: keyId });
  const jwk = response.data.key;
  const key = await importJWK(jwk as any, "ES256");
  keyCache.set(keyId, { key, fetchedAt: Date.now() });
  return key;
}

export async function verifyPlaidWebhook(
  rawBody: string,
  verificationHeader: string | null,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!verificationHeader) {
    return { ok: false, reason: "missing_plaid_verification_header" };
  }

  let keyId: string | undefined;
  try {
    const header = decodeProtectedHeader(verificationHeader);
    keyId = header.kid;
  } catch (err: any) {
    return { ok: false, reason: `malformed_jwt_header: ${err?.message ?? String(err)}` };
  }
  if (!keyId) {
    return { ok: false, reason: "jwt_header_missing_kid" };
  }

  let payload: any;
  try {
    const key = await getVerificationKey(keyId);
    const verified = await jwtVerify(verificationHeader, key, { algorithms: ["ES256"] });
    payload = verified.payload;
  } catch (err: any) {
    return { ok: false, reason: `jwt_verification_failed: ${err?.message ?? String(err)}` };
  }

  const expectedHash = createHash("sha256").update(rawBody, "utf8").digest("hex");
  if (payload.request_body_sha256 !== expectedHash) {
    return { ok: false, reason: "body_hash_mismatch" };
  }

  return { ok: true };
}

/** Test-only — clears the key cache. */
export function __test_resetWebhookKeyCache(): void {
  keyCache.clear();
}
