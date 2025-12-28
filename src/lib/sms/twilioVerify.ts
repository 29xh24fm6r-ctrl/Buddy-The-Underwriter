import "server-only";
import crypto from "crypto";

/**
 * Compute full webhook URL for Twilio signature verification
 * 
 * Twilio requires the EXACT URL it's calling to verify the signature
 * In production, this is your Vercel domain
 * In dev, this can be your ngrok URL
 * 
 * Set PUBLIC_BASE_URL in env:
 * - Production: https://buddy-the-underwriter.vercel.app
 * - Dev (ngrok): https://abc123.ngrok.io
 */
export function computeWebhookUrl(pathname: string): string {
  const base = process.env.PUBLIC_BASE_URL;
  if (!base) {
    throw new Error(
      "PUBLIC_BASE_URL is not set. Required for Twilio webhook signature verification. " +
      "Set to your production domain (e.g., https://buddy-the-underwriter.vercel.app)"
    );
  }
  return `${base.replace(/\/+$/, "")}${pathname}`;
}

/**
 * Verify Twilio webhook signature
 * 
 * Twilio signs all webhook requests with HMAC-SHA1
 * This prevents spoofed webhook calls
 * 
 * @param url - Full webhook URL (use computeWebhookUrl)
 * @param authToken - Twilio auth token
 * @param signature - X-Twilio-Signature header value
 * @param params - Form data params from webhook
 * @returns true if signature is valid
 */
export function verifyTwilioSignature(args: {
  url: string;
  authToken: string;
  signature: string | null;
  params: Record<string, string>;
}): boolean {
  const { url, authToken, signature, params } = args;
  
  if (!signature) return false;

  // Twilio signature algorithm:
  // 1. Start with the full webhook URL
  // 2. Sort params alphabetically by key
  // 3. Append each key+value (no separator)
  // 4. HMAC-SHA1 with auth token
  // 5. Base64 encode
  
  const data = url + Object.keys(params)
    .sort()
    .map((key) => key + params[key])
    .join("");

  const hmac = crypto
    .createHmac("sha1", authToken)
    .update(Buffer.from(data, "utf-8"))
    .digest("base64");

  // Timing-safe comparison
  return crypto.timingSafeEqual(
    Buffer.from(hmac),
    Buffer.from(signature)
  );
}
