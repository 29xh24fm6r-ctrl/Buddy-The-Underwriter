/**
 * Primary Action Utility — Phase 65D
 *
 * Isolated so future prioritization logic can evolve
 * without changing consumers.
 */

import type { BuddyNextAction } from "./types";

export function derivePrimaryAction(nextActions: BuddyNextAction[]): BuddyNextAction | null {
  return nextActions[0] ?? null;
}
