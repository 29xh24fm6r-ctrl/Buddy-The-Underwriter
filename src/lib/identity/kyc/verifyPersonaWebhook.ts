import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Persona webhook signature verification. Header `Persona-Signature` is
 * `t=<timestamp>,v1=<hex>`. Verify via constant-time compare of
 * HMAC-SHA256(secret, `${t}.${rawBody}`).
 * https://docs.withpersona.com/docs/webhooks#verifying-webhooks
 */
export function verifyPersonaWebhookSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;

  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const [k, v] = kv.split("=");
      return [k?.trim(), v?.trim()];
    }),
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");

  const expectedBuf = Buffer.from(expected, "hex");
  const actualBuf = Buffer.from(signature, "hex");
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
