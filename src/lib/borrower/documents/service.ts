import "server-only";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isSelfServeOrigin, isBorrowerCollectionPhase, borrowerDocumentAdmission, type AdmissionDocument } from "./admission";

export const DOCUMENT_REVIEW_COLUMNS = "id,deal_id,bank_id,status,source,sha256,is_active,intake_status,quality_status,canonical_type,doc_year,segmented,ocr_text_length,logical_key,gatekeeper_needs_review,gatekeeper_route,ai_form_numbers,statement_period";
export type ReviewDocument = AdmissionDocument & {
  id: string; deal_id: string; bank_id: string; sha256: string | null;
  ai_form_numbers: string[] | null; statement_period: string | null;
};

export async function readBorrowerDocument(dealId: string, bankId: string, documentId: string, sb = supabaseAdmin()) {
  const deal = await sb.from("deals").select("origin,intake_phase").eq("id", dealId).eq("bank_id", bankId).maybeSingle();
  if (deal.error) throw new Error("Document review could not be loaded.");
  if (!deal.data || !isSelfServeOrigin(deal.data.origin)) return null;
  const sealed = await sb.from("buddy_sealed_packages").select("id").eq("deal_id", dealId).is("unsealed_at", null).limit(1);
  if (sealed.error) throw new Error("Package protection could not be verified.");
  if (sealed.data?.length) return null;
  const result = await sb.from("deal_documents").select(DOCUMENT_REVIEW_COLUMNS)
    .eq("id", documentId).eq("deal_id", dealId).eq("bank_id", bankId).maybeSingle();
  if (result.error) throw new Error("Document details could not be loaded.");
  const doc = result.data as unknown as ReviewDocument | null;
  if (!doc || doc.status === "withdrawn" || !["borrower", "borrower_portal"].includes(doc.source ?? "")) return null;
  return { doc, phase: deal.data.intake_phase as string | null };
}

export async function canAutomaticallyProcessBorrowerDocument(dealId: string, bankId: string, documentId: string, sb = supabaseAdmin()) {
  const context = await readBorrowerDocument(dealId, bankId, documentId, sb);
  return !!context && isBorrowerCollectionPhase(context.phase) && borrowerDocumentAdmission(context.doc) === null;
}

export type DocumentClarification = { document_id: string; sha256: string; doc_type: string; tax_year: number | null; statement_period: string | null };

export async function readDocumentClarification(dealId: string, bankId: string, documentId: string, sb = supabaseAdmin()): Promise<DocumentClarification | null> {
  const context = await readBorrowerDocument(dealId, bankId, documentId, sb);
  if (!context?.doc.sha256 || context.doc.is_active !== true || !isBorrowerCollectionPhase(context.phase)) return null;
  const r = await sb.from("deal_events").select("payload").eq("deal_id", dealId)
    .eq("kind", "borrower.document.clarified")
    .contains("payload", { document_id: documentId, sha256: context.doc.sha256 })
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (r.error) throw new Error("Saved document clarification could not be verified.");
  return (r.data?.payload as DocumentClarification | undefined) ?? null;
}

/** Existing artifact queue owns execution; browser requests never run extraction. */
export async function resumeBorrowerDocuments(dealId: string, bankId: string, sb = supabaseAdmin()) {
  const result = await sb.from("document_artifacts").select("id,source_id")
    .eq("deal_id", dealId).eq("bank_id", bankId).eq("source_table", "deal_documents")
    .eq("status", "classified").order("created_at").limit(200);
  if (result.error) throw new Error("Document processing could not be resumed.");
  let queued = 0;
  for (const artifact of result.data ?? []) {
    if (queued >= 20) break;
    if (!await canAutomaticallyProcessBorrowerDocument(dealId, bankId, artifact.source_id, sb)) continue;
    const update = await sb.from("document_artifacts").update({ status: "queued", updated_at: new Date().toISOString() })
      .eq("id", artifact.id).eq("deal_id", dealId).eq("bank_id", bankId).eq("status", "classified").select("id");
    if (update.error) throw new Error("Document processing could not be resumed.");
    queued += update.data?.length ?? 0;
  }
  return queued;
}
