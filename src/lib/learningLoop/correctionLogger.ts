import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { stageEvolutionIfNeeded } from "./evolutionStager";
import type { CorrectionEvent } from "./types";

/**
 * Log an analyst correction to the extraction_correction_log table.
 * Never throws — fire-and-forget.
 */
export async function logCorrection(
  event: Omit<CorrectionEvent, "id">
): Promise<void> {
  try {
    const db = supabaseAdmin();

    await db.from("extraction_correction_log").insert({
      deal_id: event.dealId,
      document_id: event.documentId,
      document_type: event.documentType,
      tax_year: event.taxYear,
      naics_code: event.naicsCode,
      fact_key: event.factKey,
      original_value: event.originalValue,
      corrected_value: event.correctedValue,
      correction_source: event.correctionSource,
      analyst_id: event.analystId,
      corrected_at: event.correctedAt,
    });

    const delta =
      event.originalValue !== null && event.correctedValue !== null
        ? Math.abs(event.correctedValue - event.originalValue)
        : null;

    writeEvent({
      dealId: event.dealId,
      kind: "extraction.analyst_correction",
      input: {
        documentId: event.documentId,
        documentType: event.documentType,
        factKey: event.factKey,
        originalValue: event.originalValue,
        correctedValue: event.correctedValue,
        delta,
        correctionSource: event.correctionSource,
      },
    }).catch(() => {});

    // Stage potential evolution if correction pattern warrants it (fire-and-forget)
    stageEvolutionIfNeeded(event).catch(() => {});
  } catch {
    // Never throw — fire-and-forget
  }
}
