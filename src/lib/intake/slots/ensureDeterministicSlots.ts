import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import type { IntakeScenario, BusinessStage } from "./types";
import { generateSlotsForScenario } from "./policies";
import { ENTITY_SCOPED_DOC_TYPES } from "../identity/entityScopedDocTypes";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { ensureEntityBindings } from "./repair/ensureEntityBindings";
import {
  buildDealEntityGraph,
  type DealEntityGraph,
} from "@/lib/entity/buildDealEntityGraph";

// ---------------------------------------------------------------------------
// Phase 15B — Deterministic Slot Orchestrator
// ---------------------------------------------------------------------------

/**
 * Load the intake scenario for a deal.
 * Returns null if no scenario exists (legacy/conventional deal).
 */
export async function loadIntakeScenario(
  dealId: string,
): Promise<IntakeScenario | null> {
  const sb = supabaseAdmin();
  const { data } = await (sb as any)
    .from("deal_intake_scenario")
    .select("*")
    .eq("deal_id", dealId)
    .maybeSingle();

  if (!data) return null;

  return {
    product_type: data.product_type,
    borrower_business_stage: (data.borrower_business_stage ?? "EXISTING") as BusinessStage,
    has_business_tax_returns: data.has_business_tax_returns ?? true,
    has_financial_statements: data.has_financial_statements ?? true,
    has_projections: data.has_projections ?? false,
    entity_age_months: data.entity_age_months ?? null,
  };
}

/** Default scenario for conventional deals without explicit scenario data. */
export const CONVENTIONAL_FALLBACK: IntakeScenario = {
  product_type: "CONVENTIONAL",
  borrower_business_stage: "EXISTING",
  has_business_tax_returns: true,
  has_financial_statements: true,
  has_projections: false,
  entity_age_months: null,
};

/**
 * Ensure deterministic document slots for a deal based on its intake scenario.
 *
 * If no scenario exists, falls back to the conventional (Phase 15 baseline) policy.
 * Idempotent — uses UPSERT on (deal_id, slot_key).
 *
 * Stale-slot pruning: removes slots whose slot_key is NOT in the new policy set,
 * but ONLY if the slot has status 'empty' (no doc attached yet).
 */
export async function ensureDeterministicSlotsForScenario(params: {
  dealId: string;
  bankId: string;
}): Promise<{ ok: boolean; slotsUpserted: number; error?: string }> {
  const { dealId, bankId } = params;
  const sb = supabaseAdmin();

  const scenario = await loadIntakeScenario(dealId);
  const effectiveScenario = scenario ?? CONVENTIONAL_FALLBACK;

  // ── Phase T: Load entity graph for auto-scoped slot generation ──────────
  // Load entities + existing slot bindings in parallel for graph construction.
  // Single query also gives us entity count for Layer 2.3 structural check.
  const [entitiesResult, slotBindingsResult] = await Promise.all([
    (sb as any)
      .from("deal_entities")
      .select("id, entity_kind, name, legal_name, ein, meta, synthetic")
      .eq("deal_id", dealId)
      .neq("entity_kind", "GROUP"),
    (sb as any)
      .from("deal_document_slots")
      .select("required_doc_type, required_entity_id, required_entity_role")
      .eq("deal_id", dealId),
  ]);

  const rawEntities = entitiesResult.data ?? [];
  const entityCount = rawEntities.length;

  // Build entity graph for auto-scoped generation
  let graph: DealEntityGraph | undefined;
  if (rawEntities.length > 0) {
    try {
      const entities = rawEntities.map((e: any) => ({
        id: e.id,
        entityKind: e.entity_kind,
        name: e.name,
        legalName: e.legal_name ?? null,
        ein: e.ein ?? null,
        ssnLast4: (e.meta as any)?.ssn_last4 ?? null,
        synthetic: e.synthetic ?? false,
      }));

      const slotBindings = (slotBindingsResult.data ?? []).map((s: any) => ({
        requiredDocType: s.required_doc_type,
        requiredEntityId: s.required_entity_id,
        requiredEntityRole: s.required_entity_role,
      }));

      graph = buildDealEntityGraph({ entities, slotBindings });

      writeEvent({
        dealId,
        kind: "slots.entity_scoped_generated",
        scope: "slots",
        meta: {
          entity_count: graph.entities.length,
          primary_borrower_id: graph.primaryBorrowerId,
          graph_version: graph.version,
          product_type: effectiveScenario.product_type,
          version: "phase_t_v1",
        },
      }).catch(() => {});
    } catch (graphErr: any) {
      // Fail-closed for multi-entity: graphless generation would create dead-end unbound slots
      if (entityCount > 1) {
        console.error("[ensureDeterministicSlots] graph build failed for multi-entity deal", {
          dealId,
          entityCount,
          error: graphErr?.message,
        });

        writeEvent({
          dealId,
          kind: "slots.entity_scope_generation_failed",
          scope: "slots",
          requiresHumanReview: true,
          meta: {
            error: graphErr?.message?.slice(0, 200),
            entity_count: entityCount,
            product_type: effectiveScenario.product_type,
            version: "phase_t_v1",
          },
        }).catch(() => {});

        return { ok: false, slotsUpserted: 0, error: "entity_graph_build_failed" };
      }

      // Single-entity: safe to fall back to graphless generation
      console.warn("[ensureDeterministicSlots] graph build failed for single-entity deal (continuing without graph)", {
        dealId,
        error: graphErr?.message,
      });
    }
  }

  const definitions = generateSlotsForScenario(effectiveScenario, undefined, graph);

  if (definitions.length === 0) {
    console.error("[ensureDeterministicSlots] policy returned 0 slots", {
      dealId,
      scenario: effectiveScenario,
    });
    return { ok: false, slotsUpserted: 0, error: "policy_returned_zero_slots" };
  }

  const rows = definitions.map((def) => ({
    deal_id: dealId,
    bank_id: bankId,
    slot_key: def.slot_key,
    slot_group: def.slot_group,
    required: def.required,
    required_doc_type: def.required_doc_type,
    required_tax_year: def.required_tax_year,
    owner_id: null,
    owner_display_name: null,
    status: "empty",
    sort_order: def.sort_order,
    slot_mode: def.slot_mode,
    interactive_kind: def.interactive_kind,
    help_title: def.help_title ?? null,
    help_reason: def.help_reason ?? null,
    help_examples: def.help_examples ?? null,
    help_alternatives: def.help_alternatives ?? null,
    // Phase T: persist entity bindings from graph-based generation
    required_entity_id: def.required_entity_id ?? null,
    required_entity_role: def.required_entity_role ?? null,
  }));

  const { data, error } = await (sb as any)
    .from("deal_document_slots")
    .upsert(rows, { onConflict: "deal_id,slot_key", ignoreDuplicates: false })
    .select("id");

  if (error) {
    console.error("[ensureDeterministicSlots] upsert failed", {
      dealId,
      error: error.message,
    });
    return { ok: false, slotsUpserted: 0, error: error.message };
  }

  // ── Layer 2.3: Slot entity structural integrity (v1.3 — always-on) ──────────
  // Emits slot.entity_binding_missing as a first-class structural finding
  // for each entity-scoped slot definition lacking required_entity_id
  // on a multi-entity deal. This is a finding, not a blocker.
  // Fail-open: single entity | count query error → no events.
  if ((entityCount ?? 0) > 1) {
    for (const def of definitions) {
      if (ENTITY_SCOPED_DOC_TYPES.has(def.required_doc_type) && !def.required_entity_id) {
        writeEvent({
          dealId,
          kind: "slot.entity_binding_missing",
          scope: "slots",
          meta: {
            slot_key: def.slot_key,
            required_doc_type: def.required_doc_type,
            entity_count: entityCount,
            product_type: effectiveScenario.product_type,
          },
        }).catch(() => {});
      }
    }
  }

  // ── Layer 2.4: Identity graph structural closure (v1.3 — always-on) ─────────
  // Synchronous. Throws on structural invariant violation.
  await ensureEntityBindings(dealId);

  // Prune stale empty slots (key not in new policy + status === "empty")
  const activeKeys = new Set(definitions.map((d) => d.slot_key));

  const { data: existingSlots } = await (sb as any)
    .from("deal_document_slots")
    .select("id, slot_key, status")
    .eq("deal_id", dealId);

  const staleIds = (existingSlots ?? [])
    .filter((s: any) => !activeKeys.has(s.slot_key) && s.status === "empty")
    .map((s: any) => s.id);

  if (staleIds.length > 0) {
    await (sb as any)
      .from("deal_document_slots")
      .delete()
      .in("id", staleIds);
  }

  console.log("[ensureDeterministicSlots] slots ensured", {
    dealId,
    upserted: data?.length ?? 0,
    pruned: staleIds.length,
    product: effectiveScenario.product_type,
    stage: effectiveScenario.borrower_business_stage,
  });

  return { ok: true, slotsUpserted: data?.length ?? 0 };
}
