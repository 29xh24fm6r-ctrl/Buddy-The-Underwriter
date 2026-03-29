// Pure function. No DB. No side effects. No network.
import type { RelationshipSurfaceItem, CommandSurfaceListResponse } from "./types";

/**
 * Build the summary counts from a list of surface items.
 */
export function buildRelationshipSurfaceSummary(
  items: RelationshipSurfaceItem[],
  computedAt: string,
): CommandSurfaceListResponse {
  return {
    summary: {
      total: items.length,
      critical: items.filter((i) => i.priorityBucket === "critical").length,
      urgent: items.filter((i) => i.priorityBucket === "urgent").length,
      watch: items.filter((i) => i.priorityBucket === "watch").length,
      healthy: items.filter((i) => i.priorityBucket === "healthy").length,
    },
    items,
    computedAt,
  };
}
