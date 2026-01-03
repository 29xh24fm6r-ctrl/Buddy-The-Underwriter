/**
 * simulateDealMode — Override derived state in test mode
 * 
 * CLEAN PATTERN:
 * - Does NOT mutate DB
 * - Only overrides in-memory derived state
 * - If no simulation → returns real mode
 * 
 * Usage:
 *   const realMode = deriveDealMode(checklist);
 *   const displayMode = simulateDealMode(realMode, testOverride);
 */

import { DealMode } from "@/lib/deals/dealMode";

export function simulateDealMode(
  realMode: DealMode,
  simulatedMode?: DealMode | null
): DealMode {
  return simulatedMode ?? realMode;
}

/**
 * Helper to parse simulation from URL
 */
export function parseSimulatedMode(
  searchParams: URLSearchParams
): DealMode | null {
  const sim = searchParams.get("__simulate");
  if (!sim) return null;

  const validModes: DealMode[] = [
    "initializing",
    "needs_input",
    "processing",
    "ready",
    "blocked",
  ];

  return validModes.includes(sim as DealMode) ? (sim as DealMode) : null;
}
