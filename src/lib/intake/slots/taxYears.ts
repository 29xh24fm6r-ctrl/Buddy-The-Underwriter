// ---------------------------------------------------------------------------
// Phase 15 — Pure tax year computation (no server-only dependency)
// ---------------------------------------------------------------------------

/**
 * Compute the 3 most recent **filed** tax years.
 *
 * Filing-deadline-aware:
 *   Before April 15 → most recent filed year is currentYear - 2
 *   On/after April 15 → most recent filed year is currentYear - 1
 *
 * Rationale: business returns are due March 15, personal April 15.
 * Before April 15 most borrowers will not yet have the prior-year return.
 *
 * Examples:
 *   Feb 2026 → [2024, 2023, 2022]   (2025 returns not filed yet)
 *   May 2026 → [2025, 2024, 2023]   (2025 returns filed by April 15)
 */
export function computeTaxYears(now: Date = new Date()): number[] {
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed (0 = Jan, 3 = Apr)
  const day = now.getDate();

  // Before April 15: prior-year returns aren't filed yet
  const mostRecent = month < 3 || (month === 3 && day < 15)
    ? year - 2
    : year - 1;

  return [mostRecent, mostRecent - 1, mostRecent - 2];
}
