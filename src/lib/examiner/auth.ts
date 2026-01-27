/**
 * Examiner Auth Middleware.
 *
 * Validates examiner access tokens (bearer or query param grant_id).
 * Separate from Clerk — examiner tokens are scoped access grants.
 *
 * Returns the grant + resolved scope if valid, or a rejection reason.
 *
 * Server-only.
 */
import "server-only";

import {
  getActiveGrant,
  validateGrantScope,
  type ExaminerAccessGrant,
  type ExaminerAccessScope,
} from "./examinerAccessGrants";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ExaminerAuthResult =
  | {
      ok: true;
      grant: ExaminerAccessGrant;
      bankId: string;
      scope: ExaminerAccessScope;
    }
  | {
      ok: false;
      reason: "missing_token" | "invalid_token" | "expired" | "revoked" | "not_found";
      message: string;
    };

export type ExaminerScopeCheck =
  | { allowed: true }
  | { allowed: false; reason: string };

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * Authenticate an examiner from a grant ID.
 *
 * Accepts grant_id from:
 *   - Query parameter: ?grant_id=...
 *   - Bearer token: Authorization: Bearer ...
 *
 * Returns the grant + scope if valid.
 */
export async function authenticateExaminer(opts: {
  grantId?: string | null;
  bearerToken?: string | null;
}): Promise<ExaminerAuthResult> {
  const token = opts.grantId || opts.bearerToken;

  if (!token) {
    return {
      ok: false,
      reason: "missing_token",
      message: "Examiner access requires a grant_id or Bearer token.",
    };
  }

  // UUID-ish validation (loose)
  if (token.length < 10 || token.length > 50) {
    return {
      ok: false,
      reason: "invalid_token",
      message: "Invalid token format.",
    };
  }

  const grant = await getActiveGrant(token);

  if (!grant) {
    return {
      ok: false,
      reason: "not_found",
      message: "Grant not found, expired, or revoked.",
    };
  }

  if (!grant.is_active) {
    const isExpired = new Date(grant.expires_at) <= new Date();
    return {
      ok: false,
      reason: isExpired ? "expired" : "revoked",
      message: isExpired
        ? "Grant has expired."
        : "Grant has been revoked.",
    };
  }

  return {
    ok: true,
    grant,
    bankId: grant.bank_id,
    scope: grant.scope,
  };
}

/**
 * Check if an authenticated examiner can access a specific deal + area.
 */
export function checkExaminerScope(
  grant: ExaminerAccessGrant,
  dealId: string,
  area: string,
): ExaminerScopeCheck {
  const result = validateGrantScope(grant, dealId, area);
  return result.allowed
    ? { allowed: true }
    : { allowed: false, reason: result.reason };
}

/**
 * Check if downloads are allowed for this grant.
 */
export function canExaminerDownload(scope: ExaminerAccessScope): boolean {
  // Downloads disabled by default — only enabled via explicit scope flag
  return (scope as Record<string, unknown>).allow_downloads === true;
}

/**
 * Extract grant_id from a request.
 * Checks query param first, then Authorization header.
 */
export function extractGrantId(opts: {
  searchParams?: URLSearchParams;
  authHeader?: string | null;
}): string | null {
  // Query param takes precedence
  const queryGrant = opts.searchParams?.get("grant_id");
  if (queryGrant) return queryGrant;

  // Bearer token fallback
  const auth = opts.authHeader;
  if (auth?.startsWith("Bearer ")) {
    return auth.slice(7);
  }

  return null;
}
