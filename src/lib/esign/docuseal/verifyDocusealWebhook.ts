import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * DocuSeal webhook signature verification. Self-hosted DocuSeal sends the
 * configured webhook secret verbatim in the `X-Docuseal-Signature` header
 * as an HMAC-SHA256 hex digest of the raw request body — this is the
 * standard pattern DocuSeal's webhook settings support (see
 * infrastructure/docuseal/README.md for where DOCUSEAL_WEBHOOK_SECRET is
 * configured on the instance).
 *
 * No live DocuSeal instance is deployed in this environment to confirm the
 * header name/format against; verify this against the actual instance's
 * webhook docs at deployment time and adjust if it differs.
 */
export function verifyDocusealWebhookSignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;

  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  let actualBuf: Buffer;
  try {
    actualBuf = Buffer.from(header, "hex");
  } catch {
    return false;
  }
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
