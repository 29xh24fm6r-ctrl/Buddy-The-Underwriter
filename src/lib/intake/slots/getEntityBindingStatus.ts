import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ENTITY_SCOPED_DOC_TYPES } from "@/lib/intake/identity/entityScopedDocTypes";

/**
 * Canonical entity-binding status for a deal.
 *
 * Single source of truth used by:
 *   - computeDealReadiness (readiness gate)
 *   - processing-status route (UI polling)
 *   - slot generation decisioning
 *
 * Throws on query errors — caller decides fail-closed vs fail-open.
 */

export type EntityBindingStatus = {
  entityCount: number;
  unboundEntityScopedSlotCount: number;
  entityBindingRequired: boolean;
  reasons: string[];
};

export async function getEntityBindingStatus(
  dealId: string,
): Promise<EntityBindingStatus> {
  const sb = supabaseAdmin();

  const [entityResult, slotsResult] = await Promise.all([
    (sb as any)
      .from("deal_entities")
      .select("id", { count: "exact", head: true })
      .eq("deal_id", dealId),
    (sb as any)
      .from("deal_document_slots")
      .select("id")
      .eq("deal_id", dealId)
      .in("required_doc_type", [...ENTITY_SCOPED_DOC_TYPES])
      .is("required_entity_id", null),
  ]);

  if (entityResult.error) {
    throw new Error(
      `[getEntityBindingStatus] entity count query failed: ${entityResult.error.message}`,
    );
  }
  if (slotsResult.error) {
    throw new Error(
      `[getEntityBindingStatus] unbound slots query failed: ${slotsResult.error.message}`,
    );
  }

  const entityCount = entityResult.count ?? 0;
  const unboundEntityScopedSlotCount = slotsResult.data?.length ?? 0;
  const entityBindingRequired =
    entityCount > 1 && unboundEntityScopedSlotCount > 0;

  const reasons: string[] = [];
  if (entityBindingRequired) {
    reasons.push("unbound_entity_scoped_slots");
  }

  return {
    entityCount,
    unboundEntityScopedSlotCount,
    entityBindingRequired,
    reasons,
  };
}
