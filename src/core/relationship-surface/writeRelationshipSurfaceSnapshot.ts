import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { RelationshipSurfaceItem } from "./types";

/**
 * Persist a surface snapshot for fast subsequent reads.
 * Non-blocking — errors are logged but never thrown.
 * Snapshots are projections, not truth.
 */
export async function writeRelationshipSurfaceSnapshot(
  item: RelationshipSurfaceItem,
): Promise<void> {
  try {
    const sb = supabaseAdmin();

    // Delete previous snapshot for this relationship
    await sb
      .from("relationship_surface_snapshots")
      .delete()
      .eq("relationship_id", item.relationshipId)
      .eq("bank_id", item.bankId);

    // Insert fresh snapshot
    await sb.from("relationship_surface_snapshots").insert({
      relationship_id: item.relationshipId,
      bank_id: item.bankId,
      priority_bucket: item.priorityBucket,
      priority_score: item.priorityScore,
      primary_reason_code: item.primaryReasonCode,
      primary_action_code: item.primaryActionCode,
      changed_since_viewed: item.changedSinceViewed,
      surface_payload: item as unknown as Record<string, unknown>,
      computed_at: item.computedAt,
    });
  } catch (err) {
    console.error("[writeRelationshipSurfaceSnapshot] error:", err);
  }
}
