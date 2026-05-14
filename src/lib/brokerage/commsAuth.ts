/**
 * Brokerage comms auth + production guardrails.
 */
import "server-only";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";

export type CommsAuthResult = { authorized: boolean; userId?: string; error?: string };

export async function requireBrokerageCommsAdmin(): Promise<CommsAuthResult> {
  try {
    const { userId } = await requireSuperAdmin();
    return { authorized: true, userId };
  } catch (err: any) {
    const msg = String(err?.message ?? "unauthorized");
    if (msg === "auth_not_configured") {
      // Dev/test fallback — allow when Clerk not configured
      return { authorized: true, userId: "dev-fallback" };
    }
    return { authorized: false, error: msg };
  }
}

/** Redact any secrets from a response object before returning */
export function redactResponseSecrets(obj: Record<string, any>): Record<string, any> {
  const json = JSON.stringify(obj);
  const cleaned = json
    .replace(/re_[A-Za-z0-9_-]{10,}/g, "[REDACTED]")
    .replace(/KEY[A-Za-z0-9_-]{20,}/g, "[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9_.-]+/gi, "Bearer [REDACTED]")
    .replace(/"(RESEND_API_KEY|TELNYX_API_KEY|SLACK_WEBHOOK_URL|password|secret|token_hash|rawToken)":\s*"[^"]*"/g, '"$1":"[REDACTED]"');
  return JSON.parse(cleaned);
}
