/**
 * Phase 53B — Typed Access Errors
 *
 * Thrown by authz helpers when access requirements are not met.
 * API routes catch these to return controlled JSON errors.
 * Page/layout callers should use the result-returning variants in authz.ts.
 */

export class AuthenticationRequiredError extends Error {
  public readonly code = "authentication_required" as const;
  public readonly status = 401;
  constructor(detail?: string) {
    super(detail ?? "Authentication required");
    this.name = "AuthenticationRequiredError";
  }
}

export class ProfileRequiredError extends Error {
  public readonly code = "profile_required" as const;
  public readonly status = 403;
  constructor(detail?: string) {
    super(detail ?? "User profile not found");
    this.name = "ProfileRequiredError";
  }
}

export class BankMembershipRequiredError extends Error {
  public readonly code = "bank_membership_required" as const;
  public readonly status = 403;
  constructor(detail?: string) {
    super(detail ?? "No active bank membership");
    this.name = "BankMembershipRequiredError";
  }
}

export class DealAccessDeniedError extends Error {
  public readonly code = "deal_access_denied" as const;
  public readonly status: 403 | 404;
  constructor(reason: "not_found" | "tenant_mismatch", detail?: string) {
    super(detail ?? (reason === "not_found" ? "Deal not found" : "Deal belongs to a different bank"));
    this.name = "DealAccessDeniedError";
    this.status = reason === "not_found" ? 404 : 403;
  }
}

export class RoleAccessDeniedError extends Error {
  public readonly code = "role_access_denied" as const;
  public readonly status = 403;
  public readonly requiredRoles: string[];
  public readonly actualRole: string | null;
  constructor(requiredRoles: string[], actualRole: string | null, detail?: string) {
    super(detail ?? `Role "${actualRole}" not in [${requiredRoles.join(",")}]`);
    this.name = "RoleAccessDeniedError";
    this.requiredRoles = requiredRoles;
    this.actualRole = actualRole;
  }
}

/** Union of all access errors for catch blocks */
export type AccessError =
  | AuthenticationRequiredError
  | ProfileRequiredError
  | BankMembershipRequiredError
  | DealAccessDeniedError
  | RoleAccessDeniedError;

/** Type guard for any access error */
export function isAccessError(err: unknown): err is AccessError {
  return (
    err instanceof AuthenticationRequiredError ||
    err instanceof ProfileRequiredError ||
    err instanceof BankMembershipRequiredError ||
    err instanceof DealAccessDeniedError ||
    err instanceof RoleAccessDeniedError
  );
}
