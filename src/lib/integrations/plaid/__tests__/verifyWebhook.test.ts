import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { generateKeyPair, SignJWT } from "jose";
import { mockServerOnly } from "../../../../../test/utils/mockServerOnly";

mockServerOnly();

const {
  PLAID_WEBHOOK_MAX_AGE_SECONDS,
  validatePlaidWebhookClaims,
  verifyPlaidWebhook,
} = require("@/lib/integrations/plaid/verifyWebhook") as typeof import("@/lib/integrations/plaid/verifyWebhook");

const NOW_SECONDS = 1_800_000_000;
const NOW_MS = NOW_SECONDS * 1000;
const BODY = JSON.stringify({
  webhook_type: "TRANSACTIONS",
  webhook_code: "SYNC_UPDATES_AVAILABLE",
  item_id: "item-test",
});
const BODY_HASH = createHash("sha256").update(BODY, "utf8").digest("hex");

async function signedWebhook(
  payload: Record<string, unknown>,
  options: { alg?: "ES256"; kid?: string } = {},
) {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: options.alg ?? "ES256", kid: options.kid ?? "test-key" })
    .sign(privateKey);
  return { token, publicKey };
}

test("accepts a freshly issued Plaid JWT with an exact raw-body hash", async () => {
  const { token, publicKey } = await signedWebhook({
    iat: NOW_SECONDS,
    request_body_sha256: BODY_HASH,
  });

  const result = await verifyPlaidWebhook(BODY, token, {
    nowMs: NOW_MS,
    resolveKey: async () => publicKey,
  });

  assert.deepEqual(result, { ok: true });
});

test("accepts the documented five-minute age boundary", () => {
  const result = validatePlaidWebhookClaims(
    BODY,
    {
      iat: NOW_SECONDS - PLAID_WEBHOOK_MAX_AGE_SECONDS,
      request_body_sha256: BODY_HASH,
    },
    NOW_MS,
  );

  assert.deepEqual(result, { ok: true });
});

test("rejects a captured valid Plaid JWT after the five-minute replay window", async () => {
  const { token, publicKey } = await signedWebhook({
    iat: NOW_SECONDS - PLAID_WEBHOOK_MAX_AGE_SECONDS - 1,
    request_body_sha256: BODY_HASH,
  });

  const result = await verifyPlaidWebhook(BODY, token, {
    nowMs: NOW_MS,
    resolveKey: async () => publicKey,
  });

  assert.deepEqual(result, { ok: false, reason: "jwt_expired" });
});

test("rejects a verified JWT without a numeric issued-at claim", async () => {
  const { token, publicKey } = await signedWebhook({
    request_body_sha256: BODY_HASH,
  });

  const result = await verifyPlaidWebhook(BODY, token, {
    nowMs: NOW_MS,
    resolveKey: async () => publicKey,
  });

  assert.deepEqual(result, { ok: false, reason: "jwt_payload_missing_iat" });
});

test("rejects a materially future-dated JWT", async () => {
  const { token, publicKey } = await signedWebhook({
    iat: NOW_SECONDS + 31,
    request_body_sha256: BODY_HASH,
  });

  const result = await verifyPlaidWebhook(BODY, token, {
    nowMs: NOW_MS,
    resolveKey: async () => publicKey,
  });

  assert.deepEqual(result, { ok: false, reason: "jwt_iat_in_future" });
});

test("rejects a valid JWT whose body was changed after signing", async () => {
  const { token, publicKey } = await signedWebhook({
    iat: NOW_SECONDS,
    request_body_sha256: BODY_HASH,
  });

  const result = await verifyPlaidWebhook(`${BODY} `, token, {
    nowMs: NOW_MS,
    resolveKey: async () => publicKey,
  });

  assert.deepEqual(result, { ok: false, reason: "body_hash_mismatch" });
});

test("rejects malformed claimed hashes before constant-time comparison", () => {
  const result = validatePlaidWebhookClaims(
    BODY,
    {
      iat: NOW_SECONDS,
      request_body_sha256: "not-a-sha256",
    },
    NOW_MS,
  );

  assert.deepEqual(result, { ok: false, reason: "body_hash_invalid" });
});

test("accepts uppercase hexadecimal hashes without weakening byte comparison", () => {
  const result = validatePlaidWebhookClaims(
    BODY,
    {
      iat: NOW_SECONDS,
      request_body_sha256: BODY_HASH.toUpperCase(),
    },
    NOW_MS,
  );

  assert.deepEqual(result, { ok: true });
});

test("rejects an unexpected JWT algorithm before requesting a provider key", async () => {
  let keyLookups = 0;
  const result = await verifyPlaidWebhook(BODY, "eyJhbGciOiJIUzI1NiIsImtpZCI6InRlc3Qta2V5In0.e30.signature", {
    nowMs: NOW_MS,
    resolveKey: async () => {
      keyLookups += 1;
      throw new Error("must not be called");
    },
  });

  assert.deepEqual(result, { ok: false, reason: "jwt_header_invalid_algorithm" });
  assert.equal(keyLookups, 0);
});

test("returns a deterministic reason when signature verification fails", async () => {
  const signed = await signedWebhook({
    iat: NOW_SECONDS,
    request_body_sha256: BODY_HASH,
  });
  const other = await generateKeyPair("ES256");

  const result = await verifyPlaidWebhook(BODY, signed.token, {
    nowMs: NOW_MS,
    resolveKey: async () => other.publicKey,
  });

  assert.deepEqual(result, { ok: false, reason: "jwt_verification_failed" });
});
