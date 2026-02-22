/**
 * Entity Binding Orchestration Engine — Phase 2.4 + 2.5
 *
 * Closes the slot ↔ entity binding gap deterministically.
 * Calls computeRepairDecision() → performs DB mutation → emits ledger events
 * → enforces structural invariant.
 *
 * After structural closure, runs Phase 2.5 identity intelligence (fail-open):
 *   - refineSyntheticEntities: renames synthetic entities if HIGH-confidence name signal
 *   - inferOwnershipGraph: infers OWNER_OF relationships for SBA single-person deals
 *
 * Throws on:
 *   - DB query failures (slots or entities load)
 *   - Structural invariant violation post-repair
 *
 * Intelligence failures are non-fatal (console.warn + continue).
 *
 * v1.3: Entity resolution always-on — no feature flag guard.
 * ENABLE_IDENTITY_INTELLIGENCE=false → intelligence block skipped.
 */
import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { ENTITY_SCOPED_DOC_TYPES } from "../../identity/entityScopedDocTypes";
import {
  computeRepairDecision,
  ENTITY_KIND_FOR_DOC_TYPE,
} from "./repairDecision";
import { refineSyntheticEntities } from "@/lib/identity/intelligence/refineSyntheticEntities";
import { inferOwnershipGraph } from "@/lib/identity/intelligence/inferOwnershipGraph";

const SYNTHETIC_NAME_FOR_KIND: Record<string, string> = {
  PERSON: "Unassigned Owner",
  OPCO: "Unassigned Business",
  PROPCO: "Unassigned Property",
  HOLDCO: "Unassigned Holding Company",
};

export type EntityBindingRepairResult = {
  bound: number;
  syntheticCreated: number;
  reviewRequired: number;
  skippedAlreadyBound: number;
};

export async function ensureEntityBindings(
  dealId: string,
): Promise<EntityBindingRepairResult> {
  const sb = supabaseAdmin();
  let bound = 0;
  let syntheticCreated = 0;
  let reviewRequired = 0;
  let skippedAlreadyBound = 0;

  // ── Load entity-scoped slots ──────────────────────────────────────────────
  const { data: slots, error: slotsErr } = await (sb as any)
    .from("deal_document_slots")
    .select("id, slot_key, required_doc_type, required_entity_id")
    .eq("deal_id", dealId)
    .in("required_doc_type", [...ENTITY_SCOPED_DOC_TYPES]);

  if (slotsErr) {
    throw new Error(
      `[ensureEntityBindings] slots load failed: ${slotsErr.message}`,
    );
  }

  // ── Load deal entities (excluding GROUP) ──────────────────────────────────
  const { data: entities, error: entErr } = await (sb as any)
    .from("deal_entities")
    .select("id, entity_kind, name, synthetic")
    .eq("deal_id", dealId)
    .neq("entity_kind", "GROUP");

  if (entErr) {
    throw new Error(
      `[ensureEntityBindings] entities load failed: ${entErr.message}`,
    );
  }

  // Track slots routed to review this run (for invariant check)
  const reviewSlotIds = new Set<string>();

  for (const slot of slots ?? []) {
    const decision = computeRepairDecision(slot, entities ?? []);

    switch (decision.action) {
      case "SKIP_ALREADY_BOUND": {
        skippedAlreadyBound++;
        break;
      }

      case "BIND_EXISTING": {
        const allowedKinds = ENTITY_KIND_FOR_DOC_TYPE[slot.required_doc_type]!;
        const entity = (entities ?? []).find((e: any) =>
          allowedKinds.includes(e.entity_kind),
        )!;

        const { error: updateErr } = await (sb as any)
          .from("deal_document_slots")
          .update({ required_entity_id: entity.id })
          .eq("id", slot.id);

        if (updateErr) {
          throw new Error(
            `[ensureEntityBindings] bind failed for slot ${slot.slot_key}: ${updateErr.message}`,
          );
        }

        writeEvent({
          dealId,
          kind: "slot.entity_auto_bound",
          scope: "slots",
          meta: {
            slot_id: slot.id,
            slot_key: slot.slot_key,
            entity_id: entity.id,
            entity_kind: entity.entity_kind,
            reason: "single_entity_match",
          },
        }).catch(() => {});

        bound++;
        break;
      }

      case "CREATE_SYNTHETIC_AND_BIND": {
        const primaryKind = decision.entityKind!;
        const syntheticName =
          SYNTHETIC_NAME_FOR_KIND[primaryKind] ?? "Unassigned Entity";

        // Idempotency: reuse existing synthetic of the same kind
        const existingSynthetic = (entities ?? []).find(
          (e: any) => e.entity_kind === primaryKind && e.synthetic === true,
        );

        let entityId: string;

        if (existingSynthetic) {
          entityId = existingSynthetic.id;
        } else {
          const { data: created, error: createErr } = await (sb as any)
            .from("deal_entities")
            .insert({
              deal_id: dealId,
              entity_kind: primaryKind,
              name: syntheticName,
              legal_name: syntheticName,
              synthetic: true,
              meta: { origin: "slot_auto_repair" },
            })
            .select("id")
            .single();

          if (createErr || !created) {
            throw new Error(
              `[ensureEntityBindings] synthetic create failed for kind ${primaryKind}: ${createErr?.message}`,
            );
          }

          entityId = created.id;
          syntheticCreated++;

          writeEvent({
            dealId,
            kind: "entity.synthetic_created",
            scope: "slots",
            meta: {
              entity_id: entityId,
              entity_kind: primaryKind,
              origin: "slot_auto_repair",
            },
          }).catch(() => {});
        }

        const { error: bindErr } = await (sb as any)
          .from("deal_document_slots")
          .update({ required_entity_id: entityId })
          .eq("id", slot.id);

        if (bindErr) {
          throw new Error(
            `[ensureEntityBindings] synthetic bind failed for slot ${slot.slot_key}: ${bindErr.message}`,
          );
        }

        writeEvent({
          dealId,
          kind: "slot.entity_auto_bound",
          scope: "slots",
          meta: {
            slot_id: slot.id,
            slot_key: slot.slot_key,
            entity_id: entityId,
            entity_kind: primaryKind,
            reason: existingSynthetic
              ? "existing_synthetic_entity"
              : "synthetic_entity_created",
          },
        }).catch(() => {});

        bound++;
        break;
      }

      case "REQUIRES_REVIEW": {
        reviewSlotIds.add(slot.id);

        const allowedKinds =
          ENTITY_KIND_FOR_DOC_TYPE[slot.required_doc_type] ?? [];
        const entityCount = (entities ?? []).filter((e: any) =>
          allowedKinds.includes(e.entity_kind),
        ).length;

        writeEvent({
          dealId,
          kind: "slot.entity_binding_requires_review",
          scope: "slots",
          meta: {
            slot_id: slot.id,
            slot_key: slot.slot_key,
            required_doc_type: slot.required_doc_type,
            entity_count: entityCount,
          },
        }).catch(() => {});

        reviewRequired++;
        break;
      }
    }
  }

  // ── Structural Invariant Enforcement ─────────────────────────────────────
  // Post-repair: every entity-scoped slot must be bound OR explicitly review-flagged.
  // Any other state is a structural integrity violation.
  const { data: postSlots, error: checkErr } = await (sb as any)
    .from("deal_document_slots")
    .select("id, slot_key, required_entity_id")
    .eq("deal_id", dealId)
    .in("required_doc_type", [...ENTITY_SCOPED_DOC_TYPES]);

  if (!checkErr && postSlots) {
    for (const slot of postSlots) {
      if (
        slot.required_entity_id == null &&
        !reviewSlotIds.has(slot.id)
      ) {
        throw new Error(
          `[ensureEntityBindings] structural invariant violated: slot "${slot.slot_key}" is neither bound nor review-flagged`,
        );
      }
    }
  }

  console.log("[ensureEntityBindings] structural closure complete", {
    dealId,
    bound,
    syntheticCreated,
    reviewRequired,
    skippedAlreadyBound,
  });

  // ── Layer 2.5: Identity intelligence (fail-open) ───────────────────────────
  // Runs AFTER structural closure. Intelligence failures must not fail the repair.
  if (process.env.ENABLE_IDENTITY_INTELLIGENCE === "true") {
    try {
      await refineSyntheticEntities(dealId);
    } catch (e: any) {
      console.warn("[ensureEntityBindings] synthetic refinement failed (non-fatal)", {
        dealId,
        error: e?.message,
      });
    }
    try {
      await inferOwnershipGraph(dealId);
    } catch (e: any) {
      console.warn("[ensureEntityBindings] ownership inference failed (non-fatal)", {
        dealId,
        error: e?.message,
      });
    }
  }

  return { bound, syntheticCreated, reviewRequired, skippedAlreadyBound };
}
