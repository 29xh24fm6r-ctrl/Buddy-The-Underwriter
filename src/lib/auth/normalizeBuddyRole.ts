import type { BuddyRole } from "@/lib/auth/roles";

/**
 * Canonical role normalizer.
 *
 * Buddy carries two role vocabularies:
 *   - App auth roles: super_admin, bank_admin, underwriter, borrower, etc.
 *   - Membership storage roles: "admin", "member"
 *
 * This function maps legacy membership labels to canonical app roles
 * so that auth decisions use a single vocabulary.
 *
 * Mapping:
 *   "admin"  → "bank_admin"
 *   "member" → "underwriter"
 *
 * All canonical BuddyRole values pass through unchanged.
 * Unknown values return null.
 */
export function normalizeBuddyRole(raw: string | null | undefined): BuddyRole | null {
  if (!raw) return null;

  switch (raw) {
    // Canonical app roles — pass through
    case "super_admin":
    case "bank_admin":
    case "underwriter":
    case "borrower":
    case "regulator_sandbox":
    case "examiner":
      return raw;

    // Legacy membership storage labels → canonical
    case "admin":
      return "bank_admin";
    case "member":
      return "underwriter";

    default:
      return null;
  }
}
