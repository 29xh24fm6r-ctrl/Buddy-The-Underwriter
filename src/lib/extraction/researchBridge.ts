/**
 * Research-Extraction Bridge — Phase 66A (Commit 11)
 *
 * Bridges the extraction layer with the research pipeline.
 * When documents are extracted, relevant facts can be fed
 * into the research evidence system for corroboration.
 *
 * EXTENDS existing extraction — does NOT modify extractors.
 * Uses: src/lib/extraction/evidence.ts (FactEvidence, ExtractionSource)
 */

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================================
// Types
// ============================================================================

export type ExtractionBridgeEvent = {
  dealId: string;
  documentId: string;
  canonicalType: string;
  factKeys: string[];
  extractionPath: string;
  confidence: number;
};

// ============================================================================
// Bridge
// ============================================================================

/**
 * Record extraction facts as research evidence for corroboration.
 * Called after successful document extraction to link extracted data
 * into the research evidence graph.
 *
 * Fire-and-forget — never throws, never blocks extraction pipeline.
 */
export async function bridgeExtractionToResearch(
  sb: SupabaseClient,
  event: ExtractionBridgeEvent,
): Promise<void> {
  try {
    // Find active research missions for this deal
    const { data: missions } = await sb
      .from("buddy_research_missions")
      .select("id")
      .eq("deal_id", event.dealId)
      .in("status", ["complete", "running"])
      .order("created_at", { ascending: false })
      .limit(3);

    if (!missions || missions.length === 0) return;

    // Create evidence entries linking extraction to research
    const rows = missions.map((m) => ({
      mission_id: m.id,
      evidence_type: "financial_metric" as const,
      source_entity_id: event.documentId,
      source_table: "deal_documents",
      claim: `Extracted ${event.factKeys.length} facts from ${event.canonicalType} document`,
      supporting_data: {
        document_id: event.documentId,
        canonical_type: event.canonicalType,
        fact_keys: event.factKeys,
        extraction_path: event.extractionPath,
      },
      confidence: event.confidence,
    }));

    await sb.from("buddy_research_evidence").insert(rows);
  } catch {
    // Fire-and-forget — log but don't throw
    console.error("[researchBridge] bridgeExtractionToResearch failed", {
      dealId: event.dealId,
      documentId: event.documentId,
    });
  }
}
