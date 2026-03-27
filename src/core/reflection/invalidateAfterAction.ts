/**
 * Post-Action Invalidation — Phase 64
 *
 * Client-side utility to invalidate SWR caches and trigger
 * route refreshes after a decision action.
 */

import { mutate } from "swr";
import type { AffectedSurfaceKey } from "./types";
import { getAffectedSurfaces } from "./affectedSurfaces";

/**
 * SWR key patterns affected by each surface.
 * Used to selectively invalidate caches.
 */
const SURFACE_CACHE_PATTERNS: Record<string, string[]> = {
  deals_command_bridge: ["/api/deals/", "/checklist/", "/documents/"],
  portfolio: ["/api/deals"],
  deal_intake: ["/api/deals"],
  credit_committee_view: ["/api/deals/", "/committee/"],
  exceptions_change_review: ["/api/exceptions", "/api/deals/"],
  pricing_memo_command_center: ["/api/deals/", "/pricing/"],
  borrower_task_inbox: ["/api/deals/", "/checklist/"],
  borrower_portal: ["/api/deals/", "/borrower/"],
  borrower_control_record: ["/api/deals/"],
};

/**
 * Invalidate all SWR caches affected by a given action.
 * Call this client-side after a successful decision action.
 */
export function invalidateAfterAction(actionKey: string, dealId?: string): void {
  const surfaces = getAffectedSurfaces(actionKey);
  const invalidated = new Set<string>();

  for (const surface of surfaces) {
    const patterns = SURFACE_CACHE_PATTERNS[surface] ?? [];
    for (const pattern of patterns) {
      const key = dealId ? pattern.replace("/api/deals/", `/api/deals/${dealId}/`) : pattern;
      if (!invalidated.has(key)) {
        invalidated.add(key);
        // Invalidate all SWR keys matching this pattern
        mutate(
          (swrKey: string) => typeof swrKey === "string" && swrKey.includes(pattern),
          undefined,
          { revalidate: true },
        );
      }
    }
  }
}

/**
 * Get the list of surfaces that need refresh after an action.
 * Useful for building action receipt messages.
 */
export function getSurfacesToRefresh(actionKey: string): AffectedSurfaceKey[] {
  return getAffectedSurfaces(actionKey);
}
