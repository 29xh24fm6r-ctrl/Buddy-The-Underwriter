import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { CorrectionEvent } from "./types";

// Error rate threshold above which we generate an evolution entry
const EVOLUTION_THRESHOLD = 0.05; // 5%
// Minimum corrections before we consider it a pattern
const MIN_CORRECTIONS_FOR_PATTERN = 3;

/**
 * Stage a potential skill evolution based on an analyst correction.
 *
 * Checks if the correction matches a known pattern (error rate > threshold).
 * If so, inserts a pending evolution entry in agent_skill_evolutions.
 *
 * This is fire-and-forget — never throws, never blocks correction logging.
 * A super-admin must approve the evolution before anything changes.
 */
export async function stageEvolutionIfNeeded(
  event: Omit<CorrectionEvent, "id">,
): Promise<void> {
  try {
    const sb = supabaseAdmin();

    // Count corrections for this fact_key + document_type combination
    const { count: correctionCount } = await sb
      .from("extraction_correction_log")
      .select("id", { count: "exact", head: true })
      .eq("document_type", event.documentType)
      .eq("fact_key", event.factKey);

    if (!correctionCount || correctionCount < MIN_CORRECTIONS_FOR_PATTERN) {
      return; // Not enough data to suggest a pattern
    }

    // Count total extractions for this combination
    const { count: extractionCount } = await sb
      .from("deal_financial_facts")
      .select("id", { count: "exact", head: true })
      .eq("fact_key", event.factKey);

    const errorRate =
      extractionCount && extractionCount > 0
        ? correctionCount / extractionCount
        : 0;

    if (errorRate < EVOLUTION_THRESHOLD) {
      return; // Below threshold — no evolution needed yet
    }

    // Check if an evolution for this fact_key + doc_type already pending
    const { data: existing } = await sb
      .from("agent_skill_evolutions")
      .select("id")
      .eq("agent_id", "extraction")
      .eq("fact_key", event.factKey)
      .eq("document_type", event.documentType)
      .eq("applied", false)
      .eq("rejected", false)
      .maybeSingle();

    if (existing) {
      return; // Already a pending evolution for this combination
    }

    const delta =
      event.originalValue !== null && event.correctedValue !== null
        ? Math.abs(event.correctedValue - event.originalValue)
        : null;

    const context =
      `Fact key "${event.factKey}" in ${event.documentType} documents has ` +
      `${correctionCount} corrections (error rate: ${(errorRate * 100).toFixed(1)}%). ` +
      `Latest correction: ${event.originalValue} → ${event.correctedValue}` +
      (delta !== null ? ` (delta: ${delta.toLocaleString()})` : "") +
      `. Review prompt template for this field.`;

    await sb.from("agent_skill_evolutions").insert({
      agent_id: "extraction",
      fact_key: event.factKey,
      document_type: event.documentType,
      source: "analyst_correction",
      context,
      proposed_change: {
        section: "Extraction Notes",
        action: "append",
        content:
          `## Known Issue — ${event.factKey} in ${event.documentType}\n` +
          `- Error rate: ${(errorRate * 100).toFixed(1)}% (${correctionCount} corrections)\n` +
          `- Typical delta: ${delta !== null ? delta.toLocaleString() : "varies"}\n` +
          `- Action: review line number mapping and extraction prompt for this field`,
      },
    });
  } catch {
    // Never throw — evolution staging must never block correction logging
  }
}
