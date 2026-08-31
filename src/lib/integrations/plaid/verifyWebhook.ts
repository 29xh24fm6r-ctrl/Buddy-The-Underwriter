import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
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
export const PLAID_WEBHOOK_MAX_AGE_SECONDS = 5 * 60;
const PLAID_WEBHOOK_FUTURE_SKEW_SECONDS = 30;

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

export type PlaidWebhookVerificationFailure =
  | "missing_plaid_verification_header"
  | "malformed_jwt_header"
  | "jwt_header_missing_kid"
  | "jwt_header_invalid_algorithm"
  | "jwt_verification_failed"
  | "jwt_payload_missing_iat"
  | "jwt_iat_in_future"
  | "jwt_expired"
  | "body_hash_invalid"
  | "body_hash_mismatch";

type PlaidWebhookVerificationDeps = {
  nowMs?: number;
  resolveKey?: (keyId: string) => Promise<any>;
};

function verifyBodyHash(rawBody: string, claimedHash: unknown): PlaidWebhookVerificationFailure | null {
  if (typeof claimedHash !== "string" || !/^[a-f0-9]{64}$/i.test(claimedHash)) {
    return "body_hash_invalid";
  }

  const expected = Buffer.from(
    createHash("sha256").update(rawBody, "utf8").digest("hex"),
    "hex",
  );
  const actual = Buffer.from(claimedHash, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return "body_hash_mismatch";
  }
  return null;
}

export function validatePlaidWebhookClaims(
  rawBody: string,
  payload: Record<string, unknown>,
  nowMs = Date.now(),
): { ok: true } | { ok: false; reason: PlaidWebhookVerificationFailure } {
  const issuedAt = payload.iat;
  if (typeof issuedAt !== "number" || !Number.isSafeInteger(issuedAt)) {
    return { ok: false, reason: "jwt_payload_missing_iat" };
  }

  const nowSeconds = Math.floor(nowMs / 1000);
  if (issuedAt > nowSeconds + PLAID_WEBHOOK_FUTURE_SKEW_SECONDS) {
    return { ok: false, reason: "jwt_iat_in_future" };
  }
  if (nowSeconds - issuedAt > PLAID_WEBHOOK_MAX_AGE_SECONDS) {
    return { ok: false, reason: "jwt_expired" };
  }

  const hashFailure = verifyBodyHash(rawBody, payload.request_body_sha256);
  if (hashFailure) return { ok: false, reason: hashFailure };
  return { ok: true };
}

export async function verifyPlaidWebhook(
  rawBody: string,
  verificationHeader: string | null,
  deps: PlaidWebhookVerificationDeps = {},
): Promise<{ ok: true } | { ok: false; reason: PlaidWebhookVerificationFailure }> {
  if (!verificationHeader) {
    return { ok: false, reason: "missing_plaid_verification_header" };
  }

  let keyId: string | undefined;
  try {
    const header = decodeProtectedHeader(verificationHeader);
    if (header.alg !== "ES256") {
      return { ok: false, reason: "jwt_header_invalid_algorithm" };
    }
    keyId = header.kid;
  } catch {
    return { ok: false, reason: "malformed_jwt_header" };
  }
  if (!keyId) {
    return { ok: false, reason: "jwt_header_missing_kid" };
  }

  let payload: Record<string, unknown>;
  try {
    const key = await (deps.resolveKey ?? getVerificationKey)(keyId);
    const verified = await jwtVerify(verificationHeader, key, { algorithms: ["ES256"] });
    payload = verified.payload;
  } catch {
    return { ok: false, reason: "jwt_verification_failed" };
  }

  return validatePlaidWebhookClaims(rawBody, payload, deps.nowMs);
}

/** Test-only — clears the key cache. */
export function __test_resetWebhookKeyCache(): void {
  keyCache.clear();
}
