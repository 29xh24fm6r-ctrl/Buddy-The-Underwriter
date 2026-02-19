/**
 * Synthetic Entity Naming Orchestrator — Phase 2.5
 *
 * Loads entities + documents from DB, calls computeRefineSyntheticDecision,
 * mutates if HIGH confidence, emits ledger events.
 *
 * Idempotency: only operates on synthetic = true entities.
 * Feature flag: ENABLE_IDENTITY_INTELLIGENCE=true required.
 */
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";
import {
  computeRefineSyntheticDecision,
  NAME_DOC_TYPES_FOR_KIND,
  type DocumentSignal,
  type SyntheticEntity,
} from "./refineSyntheticDecision";

export async function refineSyntheticEntities(dealId: string): Promise<void> {
  const sb = supabaseAdmin();

  // Load synthetic entities for this deal
  const { data: entities, error: entErr } = await (sb as any)
    .from("deal_entities")
    .select("id, entity_kind, name, synthetic")
    .eq("deal_id", dealId)
    .eq("synthetic", true);

  if (entErr) {
    throw new Error(
      `[refineSyntheticEntities] entities load failed: ${entErr.message}`,
    );
  }

  if (!entities || entities.length === 0) return;

  // Collect all relevant doc types across all synthetic entity kinds
  const allRelevantDocTypes = new Set<string>();
  for (const entity of entities) {
    const kinds = NAME_DOC_TYPES_FOR_KIND[entity.entity_kind] ?? [];
    for (const k of kinds) allRelevantDocTypes.add(k);
  }

  if (allRelevantDocTypes.size === 0) return;

  // Load documents with entity_name for this deal
  const { data: documents, error: docsErr } = await (sb as any)
    .from("deal_documents")
    .select("document_type, entity_name, classification_confidence")
    .eq("deal_id", dealId)
    .in("document_type", [...allRelevantDocTypes])
    .not("entity_name", "is", null);

  if (docsErr) {
    throw new Error(
      `[refineSyntheticEntities] documents load failed: ${docsErr.message}`,
    );
  }

  // Load banker-provided name from borrowers (deal's primary borrower)
  const { data: borrower } = await (sb as any)
    .from("borrowers")
    .select("legal_name")
    .eq("deal_id", dealId)
    .limit(1)
    .single();

  const borrowerLegalName: string | null = borrower?.legal_name ?? null;

  const docSignals: DocumentSignal[] = (documents ?? []).map((d: any) => ({
    document_type: d.document_type,
    entity_name: d.entity_name,
    classification_confidence: d.classification_confidence,
  }));

  for (const entity of entities) {
    const syntheticEntity: SyntheticEntity = {
      id: entity.id,
      entity_kind: entity.entity_kind,
      name: entity.name,
      synthetic: entity.synthetic,
    };

    const decision = computeRefineSyntheticDecision(
      syntheticEntity,
      docSignals,
      borrowerLegalName,
    );

    if (decision.action === "RENAME_SYNTHETIC" && decision.confidence === "HIGH") {
      const { error: updateErr } = await (sb as any)
        .from("deal_entities")
        .update({ name: decision.proposedName, synthetic: false })
        .eq("id", entity.id);

      if (updateErr) {
        throw new Error(
          `[refineSyntheticEntities] rename failed for entity ${entity.id}: ${updateErr.message}`,
        );
      }

      writeEvent({
        dealId,
        kind: "entity.synthetic_refined",
        scope: "slots",
        meta: {
          entity_id: entity.id,
          entity_kind: entity.entity_kind,
          previous_name: entity.name,
          new_name: decision.proposedName,
          reason: decision.reason,
        },
      }).catch(() => {});
    }
  }
}
