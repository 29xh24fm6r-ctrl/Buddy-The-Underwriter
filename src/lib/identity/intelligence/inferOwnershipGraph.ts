/**
 * Ownership Graph Inference Orchestrator — Phase 2.5
 *
 * Loads entities + product type from DB, calls computeOwnershipDecision,
 * inserts relationships into entity_relationships, emits ledger events.
 *
 * Idempotency: UNIQUE constraint on (deal_id, parent_entity_id, child_entity_id, relationship_type)
 * — uses UPSERT ON CONFLICT DO NOTHING.
 * Feature flag: ENABLE_IDENTITY_INTELLIGENCE=true required.
 */
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { computeOwnershipDecision } from "./ownershipDecision";

export async function inferOwnershipGraph(dealId: string): Promise<void> {
  const sb = supabaseAdmin();

  // Load deal entities (excluding GROUP)
  const { data: entities, error: entErr } = await (sb as any)
    .from("deal_entities")
    .select("id, entity_kind, synthetic")
    .eq("deal_id", dealId)
    .neq("entity_kind", "GROUP");

  if (entErr) {
    throw new Error(
      `[inferOwnershipGraph] entities load failed: ${entErr.message}`,
    );
  }

  if (!entities || entities.length === 0) return;

  // Load deal product type from loan_requests
  const { data: loanRequest } = await (sb as any)
    .from("loan_requests")
    .select("product_type")
    .eq("deal_id", dealId)
    .limit(1)
    .single();

  const productType: string | null = loanRequest?.product_type ?? null;

  // Load existing relationships for idempotency check
  const { data: existingRels, error: relsErr } = await (sb as any)
    .from("entity_relationships")
    .select("parent_entity_id, child_entity_id")
    .eq("deal_id", dealId);

  if (relsErr) {
    throw new Error(
      `[inferOwnershipGraph] existing relationships load failed: ${relsErr.message}`,
    );
  }

  const decisions = computeOwnershipDecision(
    entities,
    productType,
    existingRels ?? [],
  );

  for (const decision of decisions) {
    if (decision.action !== "INFER_OWNER_OF") continue;

    // Upsert with ON CONFLICT DO NOTHING for idempotency
    const { error: insertErr } = await (sb as any)
      .from("entity_relationships")
      .upsert(
        {
          deal_id: dealId,
          parent_entity_id: decision.parentEntityId,
          child_entity_id: decision.childEntityId,
          relationship_type: "OWNER_OF",
          ownership_pct: decision.ownershipPct ?? null,
          source: "DOCUMENT",
          synthetic: true,
        },
        { onConflict: "deal_id,parent_entity_id,child_entity_id,relationship_type", ignoreDuplicates: true },
      );

    if (insertErr) {
      throw new Error(
        `[inferOwnershipGraph] relationship insert failed: ${insertErr.message}`,
      );
    }

    writeEvent({
      dealId,
      kind: "entity.relationship_inferred",
      scope: "slots",
      meta: {
        parent_entity_id: decision.parentEntityId,
        child_entity_id: decision.childEntityId,
        relationship_type: "OWNER_OF",
        ownership_pct: decision.ownershipPct,
        reason: decision.reason,
      },
    }).catch(() => {});
  }
}
