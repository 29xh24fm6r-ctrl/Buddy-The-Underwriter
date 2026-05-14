/**
 * Brokerage comms auth guard stub.
 *
 * TODO: Wire to real admin auth (requireSuperAdmin / requireRoleApi)
 * before production launch. Currently allows all requests but
 * provides the interface for future gating.
 */

export type CommsAuthResult = { authorized: boolean; userId?: string; error?: string };

export async function requireBrokerageCommsAdmin(): Promise<CommsAuthResult> {
  // In test/dev: always allow
  // TODO: Replace with real auth check:
  //   const { userId } = await requireSuperAdmin();
  //   return { authorized: true, userId };
  return { authorized: true, userId: "system" };
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
