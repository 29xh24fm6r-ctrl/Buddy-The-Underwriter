/**
 * Queue a single document for async extraction via the doc.extract outbox.
 *
 * Called by processConfirmedIntake after matching, replacing inline extractByDocType().
 * The doc-extraction worker claims these events and runs extraction asynchronously.
 */

import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function queueDocExtractionOutbox(opts: {
  docId: string;
  dealId: string;
  bankId: string;
  intakeRunId: string;
}): Promise<void> {
  const sb = supabaseAdmin();
  const { error } = await sb.from("buddy_outbox_events").insert({
    kind: "doc.extract",
    deal_id: opts.dealId,
    bank_id: opts.bankId,
    source: "intake",
    payload: {
      doc_id: opts.docId,
      deal_id: opts.dealId,
      bank_id: opts.bankId,
      intake_run_id: opts.intakeRunId,
    },
  });

  if (error) {
    // Non-fatal: log but don't throw — intake processing must complete.
    // The banker can trigger re-extraction via the Re-extract All button.
    console.error("[queueDocExtractionOutbox] failed to queue", {
      docId: opts.docId,
      dealId: opts.dealId,
      error: error.message,
    });
  }
}
