import "server-only";

/**
 * resolveDocumentEntity — server wrapper for entity resolution.
 *
 * Loads deal_entities from Supabase, maps DealEntity → EntityCandidate[],
 * then delegates to the pure resolveEntity() function.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  resolveEntity,
  buildEntityCandidate,
  type EntityResolution,
  type EntityCandidate,
} from "./entityResolver";
import {
  resolveIdentityV2,
  resolveDocumentEntityTypeFromCanonical,
} from "@/lib/entity/resolveIdentityV2";
import {
  buildDealEntityGraph,
  type RawDealEntity,
  type EntitySlotBinding,
} from "@/lib/entity/buildDealEntityGraph";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ResolveDocumentEntityParams = {
  dealId: string;
  text: string;
  filename: string;
  hasEin: boolean;
  hasSsn: boolean;
  entityType?: "business" | "personal" | null;
  /** v2: Canonical doc type for entity-type derivation in resolveIdentityV2. */
  canonicalType?: string | null;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load deal entities and resolve which entity a document belongs to.
 * Returns null on DB error (caller treats as identity.entity = null → v1 fallback).
 */
export async function resolveDocumentEntityForDeal(
  params: ResolveDocumentEntityParams,
): Promise<EntityResolution | null> {
  const { dealId, text, filename, hasEin, hasSsn, entityType, canonicalType } = params;

  try {
    const sb = supabaseAdmin();
    const { data: entities, error } = await (sb as any)
      .from("deal_entities")
      .select("id, entity_kind, name, legal_name, ein, meta, synthetic")
      .eq("deal_id", dealId);

    if (error || !entities) {
      console.error("[resolveDocumentEntity] Failed to load entities:", error);
      return null;
    }

    // Filter out GROUP entities (not matchable) and map to EntityCandidate
    const candidates: EntityCandidate[] = entities
      .filter((e: any) => e.entity_kind !== "GROUP")
      .map((e: any) =>
        buildEntityCandidate({
          id: e.id,
          entityKind: e.entity_kind,
          legalName: e.legal_name ?? e.name,
          ein: e.ein ?? null,
          ssnLast4: (e.meta as Record<string, unknown>)?.ssn_last4 as string | undefined ?? null,
        }),
      );

    if (candidates.length === 0) return null;

    // ── v2 pre-binding upgrade ────────────────────────────────────────
    // Try resolveIdentityV2 first — pre-binds single-entity and type-unique
    // deals with confidence 1.0. Falls back to standard 6-tier on failure.
    try {
      const rawEntities: RawDealEntity[] = entities
        .filter((e: any) => e.entity_kind !== "GROUP")
        .map((e: any) => ({
          id: e.id,
          entityKind: e.entity_kind,
          name: e.name ?? "",
          legalName: e.legal_name ?? null,
          ein: e.ein ?? null,
          ssnLast4: (e.meta as Record<string, unknown>)?.ssn_last4 as string | undefined ?? null,
          synthetic: e.synthetic ?? false,
        }));

      // Load slot bindings for graph construction
      const { data: slotRows } = await (sb as any)
        .from("deal_document_slots")
        .select("required_doc_type, required_entity_id, required_entity_role")
        .eq("deal_id", dealId);

      const slotBindings: EntitySlotBinding[] = (slotRows ?? []).map((s: any) => ({
        requiredDocType: s.required_doc_type,
        requiredEntityId: s.required_entity_id ?? null,
        requiredEntityRole: s.required_entity_role ?? null,
      }));

      const graph = buildDealEntityGraph({ entities: rawEntities, slotBindings });

      // Derive document entity type from canonical type or spine signal
      const documentEntityType = canonicalType
        ? resolveDocumentEntityTypeFromCanonical(canonicalType)
        : (entityType ?? null);

      const v2Result = resolveIdentityV2({
        graph,
        documentEntityType,
        textSignals: { text, filename, hasEin, hasSsn },
        candidates,
      });

      // Map v2 result → EntityResolution (callers expect this shape)
      return {
        entityId: v2Result.entityId,
        entityRole: v2Result.entityRole,
        confidence: v2Result.confidence,
        ambiguous: v2Result.ambiguous,
        // v2 tiers are a superset; cast is safe since EntityInfo.tier is string | null
        tier: v2Result.tier as EntityResolution["tier"],
        evidence: v2Result.evidence,
      };
    } catch (v2Err) {
      // v2 failed (e.g. graph build error) — fall through to v1
      console.warn("[resolveDocumentEntity] v2 failed, falling back to v1:", v2Err);
    }

    // ── v1 fallback ───────────────────────────────────────────────────
    return resolveEntity(
      { text, filename, hasEin, hasSsn },
      candidates,
      entityType,
    );
  } catch (err) {
    console.error("[resolveDocumentEntity] Unexpected error:", err);
    return null;
  }
}
