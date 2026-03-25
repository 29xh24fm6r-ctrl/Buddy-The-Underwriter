/**
 * Canonical trusted-truth semantics for financial fact resolution.
 *
 * Pure module — no server-only, safe for CI guard imports.
 *
 * A fact's resolution_status on deal_financial_facts is the storage-level
 * indicator. The financial_review_resolutions table stores richer outcomes.
 * This module defines what counts as "trusted final truth" for downstream
 * consumption (snapshot, pricing, memo, readiness, gap completeness).
 *
 * Trusted final truth:
 *   - confirmed     (banker accepted extracted value)
 *   - overridden    (banker replaced value with rationale)
 *   - provided      (banker entered missing value)
 *   - selected_source (banker chose one of competing values — stored as "confirmed" on winning fact)
 *
 * NOT trusted final truth:
 *   - pending       (default — extracted but not reviewed)
 *   - rejected      (banker rejected the value)
 *   - null/undefined (no resolution status set)
 */

/** Resolution statuses that represent trusted banker-resolved truth. */
export const TRUSTED_RESOLUTION_STATUSES = new Set([
  "confirmed",
  "overridden",
  "provided",
]);

/**
 * Returns true if the resolution_status on a deal_financial_facts row
 * represents trusted final truth for downstream underwriting consumption.
 */
export function isTrustedResolution(resolutionStatus: string | null | undefined): boolean {
  if (!resolutionStatus) return false;
  return TRUSTED_RESOLUTION_STATUSES.has(resolutionStatus);
}

/**
 * Supabase filter value for querying trusted-resolution facts.
 * Use with `.in("resolution_status", TRUSTED_RESOLUTION_FILTER)`.
 */
export const TRUSTED_RESOLUTION_FILTER = ["confirmed", "overridden", "provided"];

/**
 * Human-readable label for a resolution status (for voice session context, etc.)
 */
export function resolutionLabel(resolutionStatus: string | null | undefined): string {
  switch (resolutionStatus) {
    case "confirmed":  return "confirmed by banker";
    case "overridden": return "overridden by banker";
    case "provided":   return "provided by banker";
    default:           return "extracted from documents";
  }
}
