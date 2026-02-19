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
  const { dealId, text, filename, hasEin, hasSsn, entityType } = params;

  try {
    const sb = supabaseAdmin();
    const { data: entities, error } = await (sb as any)
      .from("deal_entities")
      .select("id, entity_kind, name, legal_name, ein, meta")
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
