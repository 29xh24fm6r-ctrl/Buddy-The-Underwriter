/**
 * Queue a single document for async extraction via the doc.extract outbox.
 *
 * Called by processConfirmedIntake after matching, replacing inline extractByDocType().
 * The doc-extraction worker claims these events and runs extraction asynchronously.
 *
 * Also called by the "Re-extract All" route with forceRefresh=true to bypass
 * SHA-256 dedup and re-run Gemini on the raw PDFs.
 */

import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function queueDocExtractionOutbox(opts: {
  docId: string;
  dealId: string;
  bankId: string;
  intakeRunId?: string;
  docType?: string;
  forceRefresh?: boolean;
}): Promise<void> {
  const sb = supabaseAdmin();
  const { error } = await sb.from("buddy_outbox_events").insert({
    kind: "doc.extract",
    deal_id: opts.dealId,
    bank_id: opts.bankId,
    source: opts.forceRefresh ? "reextract" : "intake",
    payload: {
      doc_id: opts.docId,
      deal_id: opts.dealId,
      bank_id: opts.bankId,
      intake_run_id: opts.intakeRunId ?? null,
      doc_type: opts.docType ?? null,
      force_refresh: opts.forceRefresh ?? false,
    },
  });

  if (error) {
    console.error("[queueDocExtractionOutbox] failed to queue", {
      docId: opts.docId,
      dealId: opts.dealId,
      error: error.message,
    });
    // Queue persistence is operational work, not telemetry. Surface failure so
    // the intake run records it and the recovery worker can retry the document.
    throw new Error(`Failed to queue extraction for document ${opts.docId}: ${error.message}`);
  }
}
