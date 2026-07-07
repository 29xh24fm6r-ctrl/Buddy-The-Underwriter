/**
 * SPEC-SEC-1 — pure deal-access result types + status mapping.
 *
 * Deliberately free of any `server-only` import so the fail-closed status
 * matrix can be unit tested under `node --test` without a Next runtime.
 * deal-access.ts re-exports these; runtime callers should import from there.
 */
import { AuthenticationRequiredError, DealAccessDeniedError } from "./access-errors";

export type DealAccessResult =
  | {
      accessible: true;
      dealId: string;
      bankId: string;
      userId: string;
      source: "membership";
    }
  | {
      accessible: false;
      reason: "not_found" | "deal_not_found" | "tenant_mismatch" | "unauthorized";
      detail?: string;
    };

/**
 * Pure mapping: a non-accessible DealAccessResult → the typed AccessError that
 * assertDealAccess should throw. Returns null for an accessible result.
 *
 * Security invariant: every denial reason maps to a deny status (401/403/404) —
 * never success.
 */
export function dealAccessResultToError(
  result: DealAccessResult,
): AuthenticationRequiredError | DealAccessDeniedError | null {
  if (result.accessible) return null;
  if (result.reason === "unauthorized") {
    return new AuthenticationRequiredError(result.detail);
  }
  const isNotFound = result.reason === "not_found" || result.reason === "deal_not_found";
  return new DealAccessDeniedError(
    isNotFound ? "not_found" : "tenant_mismatch",
    result.detail,
  );
}
