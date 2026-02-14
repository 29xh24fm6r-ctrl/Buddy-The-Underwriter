// ---------------------------------------------------------------------------
// Phase 15 — Pure tax year computation (no server-only dependency)
// ---------------------------------------------------------------------------

/**
 * Compute the 3 most recent filing tax years.
 * Rule: [currentYear - 1, currentYear - 2, currentYear - 3]
 * Example (Feb 2026): [2025, 2024, 2023]
 */
export function computeTaxYears(now: Date = new Date()): number[] {
  const currentYear = now.getFullYear();
  return [currentYear - 1, currentYear - 2, currentYear - 3];
}
