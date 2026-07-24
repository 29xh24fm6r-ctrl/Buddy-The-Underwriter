import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * SignWell webhook verification. Unlike DocuSeal/Persona, SignWell embeds
 * the signature inside the JSON body rather than a header: `event.hash` is
 * HMAC-SHA256(key = the webhook's own id — SIGNWELL_WEBHOOK_ID, from the
 * Create/List Webhook response, NOT the API key; data = `${event.type}@${event.time}`).
 * https://developers.signwell.com/reference/events
 *
 * No live SignWell webhook has been registered in this environment to
 * confirm this against; verify at deployment time and adjust if it differs.
 */
export function verifySignwellWebhookEvent(rawBody: string, webhookId: string): boolean {
  let event: { type?: unknown; time?: unknown; hash?: unknown } | undefined;
  try {
    event = JSON.parse(rawBody)?.event;
  } catch {
    return false;
  }
  if (typeof event?.type !== "string" || (typeof event?.time !== "string" && typeof event?.time !== "number") || typeof event?.hash !== "string") {
    return false;
  }

  const expected = createHmac("sha256", webhookId).update(`${event.type}@${event.time}`).digest("hex");
  const expectedBuf = Buffer.from(expected, "hex");
  let actualBuf: Buffer;
  try {
    actualBuf = Buffer.from(event.hash, "hex");
  } catch {
    return false;
  }
  if (expectedBuf.length !== actualBuf.length) return false;
  return timingSafeEqual(expectedBuf, actualBuf);
}
