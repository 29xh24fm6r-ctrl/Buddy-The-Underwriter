/**
 * Email environment variable resolver
 * 
 * DEV NOW:
 * - FROM: EMAIL_FROM or OUTBOUND_FROM_EMAIL (existing keys)
 * - TO:   prefer existing keys, fallback to CONTACT_TO_EMAIL (temporary)
 * 
 * FUTURE:
 * - Replace TO/FROM resolution with DB-backed tenant config
 * - Per-tenant email routing table
 * - Verified sender allowlist
 */

function pickFirst(keys: string[]): { key: string; value: string } | null {
  for (const k of keys) {
    const v = process.env[k];
    if (typeof v === "string" && v.trim().length > 0) return { key: k, value: v.trim() };
  }
  return null;
}

/**
 * Resolve email routing from existing env vars
 * 
 * FROM candidates (in priority order):
 * 1. EMAIL_FROM - canonical key used across 6+ files
 * 2. OUTBOUND_FROM_EMAIL - legacy outbound system
 * 
 * TO candidates (prefer existing, fallback to temporary):
 * 1. CONTACT_TO_EMAIL - contact form destination (temporary dev key)
 * 2. EMAIL_TO - if already exists
 * 3. OUTBOUND_TO_EMAIL - if already exists
 * 4. NOTIFY_EMAIL - if already exists
 * 5. SUPPORT_EMAIL - if already exists
 * 
 * REPLY_TO candidates (optional):
 * - Falls back to submitter's email if not configured
 */
/**
 * DEV BASELINE: Environment-based email routing fallback.
 * 
 * CURRENT (DEV):
 * - FROM uses existing keys: EMAIL_FROM, OUTBOUND_FROM_EMAIL
 * - TO uses CONTACT_TO_EMAIL (temporary dev key)
 * 
 * FUTURE (PROD):
 * - Tenant routing in DB (tenant_email_routing table) takes precedence
 * - This file only serves as fallback when no tenant config exists
 * - See: src/lib/email/tenantRouting.ts for DB-backed routing
 * 
 * SAFETY:
 * - FROM allowlist: set ALLOWED_OUTBOUND_FROM_EMAILS in prod
 * - Validated in tenantRouting.ts before use
 */
export function resolveEnvFallbackEmailRouting() {
  const fromCandidateKeys = [
    "EMAIL_FROM",
    "OUTBOUND_FROM_EMAIL",
  ];

  // Prefer existing keys if present; CONTACT_TO_EMAIL is temporary dev fallback
  const toCandidateKeys = [
    "CONTACT_TO_EMAIL",
    "EMAIL_TO",
    "OUTBOUND_TO_EMAIL",
    "NOTIFY_EMAIL",
    "SUPPORT_EMAIL",
  ];

  const replyToCandidateKeys: string[] = [
    "REPLY_TO_EMAIL",
    "SUPPORT_REPLY_TO",
  ];

  const from = pickFirst(fromCandidateKeys);
  const to = pickFirst(toCandidateKeys);
  const replyTo = pickFirst(replyToCandidateKeys);

  return {
    from,
    to,
    replyTo,
    missing: {
      from: !from,
      to: !to,
    },
  };
}
