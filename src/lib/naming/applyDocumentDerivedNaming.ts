/**
 * Apply derived naming to a document after classification/OCR.
 *
 * Reads the document's classification data, computes the display name,
 * and updates the row. Idempotent: same inputs produce the same name.
 *
 * Emits ledger events for every naming decision.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { deriveDocumentDisplayName } from "./deriveDocumentDisplayName";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export type ApplyDocumentDerivedNamingResult = {
  ok: boolean;
  displayName: string | null;
  method: "provisional" | "derived" | null;
  changed: boolean;
  error?: string;
};

export async function applyDocumentDerivedNaming(opts: {
  documentId: string;
  dealId: string;
  bankId: string;
}): Promise<ApplyDocumentDerivedNamingResult> {
  const { documentId, dealId, bankId } = opts;
  const sb = supabaseAdmin();

  // 1. Read the document's current state
  const { data: doc, error: readErr } = await sb
    .from("deal_documents")
    .select(
      "id, original_filename, display_name, naming_method, document_type, doc_year, entity_name, ai_business_name, ai_borrower_name, classification_confidence",
    )
    .eq("id", documentId)
    .maybeSingle();

  if (readErr || !doc) {
    return { ok: false, displayName: null, method: null, changed: false, error: readErr?.message ?? "not_found" };
  }

  // Don't overwrite manual naming
  if (doc.naming_method === "manual") {
    return { ok: true, displayName: doc.display_name, method: "manual" as any, changed: false };
  }

  // Pick the best entity name: ai_business_name > ai_borrower_name > entity_name
  const entityName =
    (doc as any).ai_business_name ||
    (doc as any).ai_borrower_name ||
    doc.entity_name ||
    null;

  // 2. Compute derived name
  const result = deriveDocumentDisplayName({
    originalFilename: doc.original_filename ?? "",
    documentType: doc.document_type,
    docYear: doc.doc_year,
    entityName,
    classificationConfidence: doc.classification_confidence,
  });

  // 3. Check if name actually changed (idempotency)
  if (doc.display_name === result.displayName && doc.naming_method === result.method) {
    return { ok: true, displayName: result.displayName, method: result.method, changed: false };
  }

  // 4. Update the document row
  const nowIso = new Date().toISOString();
  const { error: updateErr } = await sb
    .from("deal_documents")
    .update({
      display_name: result.displayName,
      naming_method: result.method,
      naming_source: result.source,
      naming_confidence: result.confidence,
      naming_fallback_reason: result.fallbackReason,
      named_at: nowIso,
    } as any)
    .eq("id", documentId);

  if (updateErr) {
    // Emit failure event
    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "doc.name.derive_failed",
      uiState: "error",
      uiMessage: `Failed to set display name for document`,
      meta: {
        doc_id: documentId,
        method: result.method,
        source: result.source,
        error: updateErr.message,
      },
    });

    return { ok: false, displayName: null, method: null, changed: false, error: updateErr.message };
  }

  // 5. Emit ledger event
  const eventKey = result.method === "derived"
    ? "doc.name.derived_set"
    : "doc.name.provisional_set";

  await logLedgerEvent({
    dealId,
    bankId,
    eventKey,
    uiState: "done",
    uiMessage: `Document named: "${result.displayName}"`,
    meta: {
      doc_id: documentId,
      method: result.method,
      source: result.source,
      confidence: result.confidence,
      fallback_reason: result.fallbackReason,
      document_type: doc.document_type,
      doc_year: doc.doc_year,
      // entity_name intentionally omitted (PII)
    },
  });

  return {
    ok: true,
    displayName: result.displayName,
    method: result.method,
    changed: true,
  };
}
