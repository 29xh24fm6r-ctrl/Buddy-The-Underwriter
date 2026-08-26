import crypto from "node:crypto";

/**
 * Sign a chooser payload with an explicit server-provided key.
 *
 * Keeping key selection outside this pure helper makes it impossible for a
 * browser bundle to discover or choose a privileged credential implicitly.
 */
export function signChooserPayload(payload: string, signingKey: string): string {
  const signature = crypto
    .createHmac("sha256", signingKey)
    .update(payload)
    .digest("hex");

  return `${Buffer.from(payload).toString("base64url")}.${signature}`;
}

/**
 * Verify and decode a chooser token.
 *
 * Malformed signatures are rejected before timingSafeEqual so attacker-
 * controlled lengths or non-hex input can never throw at the auth boundary.
 */
export function verifyChooserPayload(token: string, signingKey: string): string | null {
  const dotIdx = token.lastIndexOf(".");
  if (dotIdx <= 0) return null;

  const payloadB64 = token.slice(0, dotIdx);
  const providedSigHex = token.slice(dotIdx + 1);

  if (!/^[A-Za-z0-9_-]+$/.test(payloadB64)) return null;
  if (!/^[0-9a-f]{64}$/i.test(providedSigHex)) return null;

  let payload: string;
  try {
    payload = Buffer.from(payloadB64, "base64url").toString("utf-8");
  } catch {
    return null;
  }

  const expectedSig = crypto
    .createHmac("sha256", signingKey)
    .update(payload)
    .digest();
  const providedSig = Buffer.from(providedSigHex, "hex");

  if (providedSig.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(providedSig, expectedSig)) return null;

  return payload;
}
