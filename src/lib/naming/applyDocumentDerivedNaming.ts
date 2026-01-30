/**
 * Apply derived naming to a document after classification/OCR.
 *
 * Reads the document's classification data, computes the display name,
 * and updates the row. Idempotent: same inputs produce the same name.
 *
 * Guards:
 *   - name_locked = true  → never overwrite
 *   - naming_method = 'manual' → never overwrite
 *   - confidence < 0.80  → keep provisional
 *
 * Emits canonical `artifact.name.derived` ledger events via writeEvent.
 */

import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { deriveDocumentDisplayName } from "./deriveDocumentDisplayName";
import { writeEvent } from "@/lib/ledger/writeEvent";

const MIN_CONFIDENCE = 0.80;

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
      "id, original_filename, display_name, naming_method, name_locked, document_type, doc_year, entity_name, ai_business_name, ai_borrower_name, classification_confidence",
    )
    .eq("id", documentId)
    .maybeSingle();

  if (readErr || !doc) {
    return { ok: false, displayName: null, method: null, changed: false, error: readErr?.message ?? "not_found" };
  }

  const previousName = doc.display_name ?? doc.original_filename ?? null;
  const locked = Boolean((doc as any).name_locked);

  // Guard: name_locked
  if (locked) {
    await emitArtifactNameDerived(dealId, {
      artifact_id: documentId,
      previous_name: previousName,
      derived_name: null,
      changed: false,
      source: "fallback",
      confidence: null,
      fallback_reason: "locked",
      locked: true,
    });
    return { ok: true, displayName: doc.display_name, method: "manual" as any, changed: false };
  }

  // Guard: naming_method = manual
  if (doc.naming_method === "manual") {
    await emitArtifactNameDerived(dealId, {
      artifact_id: documentId,
      previous_name: previousName,
      derived_name: null,
      changed: false,
      source: "fallback",
      confidence: null,
      fallback_reason: "locked",
      locked: false,
    });
    return { ok: true, displayName: doc.display_name, method: "manual" as any, changed: false };
  }

  // Guard: one auto-upgrade max — if already derived, never auto-rename again
  if (doc.naming_method === "derived") {
    await emitArtifactNameDerived(dealId, {
      artifact_id: documentId,
      previous_name: previousName,
      derived_name: null,
      changed: false,
      source: "fallback",
      confidence: null,
      fallback_reason: "already_derived",
      locked: false,
    });
    return { ok: true, displayName: doc.display_name, method: "derived", changed: false };
  }

  // Guard: confidence threshold
  const confidence = doc.classification_confidence;
  if (typeof confidence === "number" && confidence < MIN_CONFIDENCE) {
    await emitArtifactNameDerived(dealId, {
      artifact_id: documentId,
      previous_name: previousName,
      derived_name: null,
      changed: false,
      source: "fallback",
      confidence,
      fallback_reason: "low_confidence",
      locked: false,
    });
    return { ok: true, displayName: doc.display_name, method: "provisional", changed: false };
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
    await emitArtifactNameDerived(dealId, {
      artifact_id: documentId,
      previous_name: previousName,
      derived_name: result.displayName,
      changed: false,
      source: result.source === "classification" ? "classification" : "fallback",
      confidence: result.confidence,
      locked: false,
    });
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
    await emitArtifactNameDerived(dealId, {
      artifact_id: documentId,
      previous_name: previousName,
      derived_name: null,
      changed: false,
      source: "fallback",
      confidence: null,
      fallback_reason: "low_confidence",
      locked: false,
    });
    return { ok: false, displayName: null, method: null, changed: false, error: updateErr.message };
  }

  // 5. Emit canonical ledger event
  await emitArtifactNameDerived(dealId, {
    artifact_id: documentId,
    previous_name: previousName,
    derived_name: result.displayName,
    changed: true,
    source: result.source === "classification" ? "classification" : "fallback",
    confidence: result.confidence,
    locked: false,
  });

  return {
    ok: true,
    displayName: result.displayName,
    method: result.method,
    changed: true,
  };
}

// ─── Canonical ledger helper ────────────────────────────────────────────────

type ArtifactNameDerivedPayload = {
  artifact_id: string;
  previous_name: string | null;
  derived_name: string | null;
  changed: boolean;
  source: "classification" | "fallback";
  confidence: number | null;
  fallback_reason?: string;
  locked: boolean;
};

async function emitArtifactNameDerived(
  dealId: string,
  payload: ArtifactNameDerivedPayload,
): Promise<void> {
  await writeEvent({
    dealId,
    kind: "artifact.name.derived",
    scope: "naming",
    action: "derive_artifact_name",
    output: payload,
    confidence: payload.confidence,
    meta: {
      artifact_id: payload.artifact_id,
      changed: payload.changed,
      source: payload.source,
      locked: payload.locked,
      fallback_reason: payload.fallback_reason ?? null,
    },
  });
}
