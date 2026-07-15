import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Didit webhook verification, "Simple Signature" scheme (the documented
 * fallback — Didit's preferred scheme, X-Signature-V2, HMACs a
 * recursively key-sorted JSON canonicalization of the full body including
 * the decision object; that canonicalization algorithm hasn't been
 * confirmed against a live account yet, so Simple Signature is implemented
 * here as the verifiable option today).
 *
 * Header `X-Signature-Simple` = HMAC-SHA256(secret, data), where
 * data = `${timestamp}:${session_id}:${status}:${webhook_type}` and
 * timestamp comes from the `X-Timestamp` header (also used for replay
 * protection — requests older than 5 minutes are rejected).
 * https://docs.didit.me/integration/webhooks
 *
 * No live Didit webhook has been registered in this environment to
 * confirm this against; verify at deployment time and adjust if it differs.
 */

const MAX_CLOCK_SKEW_SECONDS = 300;

export function verifyDiditWebhookSignature(params: {
  sessionId: string;
  status: string;
  webhookType: string;
  timestampHeader: string | null;
  signatureHeader: string | null;
  secret: string;
}): boolean {
  const { sessionId, status, webhookType, timestampHeader, signatureHeader, secret } = params;
  if (!timestampHeader || !signatureHeader) return false;

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > MAX_CLOCK_SKEW_SECONDS) return false;

  const data = `${timestampHeader}:${sessionId}:${status}:${webhookType}`;
  const expected = createHmac("sha256", secret).update(data).digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  let actualBuf: Buffer;
  try {
    actualBuf = Buffer.from(signatureHeader, "hex");
  } catch {
    return false;
  }
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
