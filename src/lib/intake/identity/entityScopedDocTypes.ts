/**
 * Slot doc types that must be entity-bound when a deal has multiple entities.
 * Canonical governance contract — used by intake structural integrity checks.
 * CI-locked: slotBindingGuard.test.ts validates membership and exclusions.
 *
 * Kept tight at 3 types: highest leverage, lowest ambiguity entity-scoped categories.
 * Expansion requires CI guard update + binding coverage verification.
 */
export const ENTITY_SCOPED_DOC_TYPES = new Set([
  "PERSONAL_TAX_RETURN",
  "PERSONAL_FINANCIAL_STATEMENT",
  "BUSINESS_TAX_RETURN",
]);
