import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { isTaxReturnDocument, resolveIrsFormType } from "./resolveIrsFormType";
import { runPostExtractionValidation } from "./postExtractionValidator";
import {
  resolveDocTaxYear,
  summarizeRevalidation,
  type RevalidationDocOutcome,
  type RevalidationDocRow,
  type RevalidationSummary,
} from "./revalidationSummary";

// Re-export the pure helpers + types so callers can import everything from the
// orchestrator module (the helpers live in revalidationSummary.ts so they stay
// importable from server-only-free unit tests).
export {
  resolveDocTaxYear,
  summarizeRevalidation,
} from "./revalidationSummary";
export type {
  RevalidationDocOutcome,
  RevalidationDocRow,
  RevalidationSummary,
  PerDocRevalidation,
} from "./revalidationSummary";

/**
 * SPEC-VALIDATION-GATE-RESTORE-PROGRAM-1 Phase 2 — deal-level revalidation.
 *
 * runPostExtractionValidation runs per-document right after each doc's
 * extraction, so it captures a partial fact set and never re-runs once the
 * deal's facts are complete. The persisted deal_document_validation_results
 * rows are therefore stale mid-flight snapshots (e.g. 1120_GROSS_PROFIT skipped
 * for "Missing facts: COST_OF_GOODS_SOLD" when COGS is plainly present).
 *
 * This orchestrator re-runs the SAME per-document validator against the deal's
 * COMPLETE current fact set — no re-extraction. The per-doc validator is
 * untouched; we only enumerate and aggregate.
 *
 * Self-gating is delegated to the validator: non-tax docs return SKIPPED with
 * no row; the deal-level validation_disabled flag is honoured inside the
 * validator. We do NOT pre-filter tax vs non-tax — single source of truth.
 *
 * Never throws — a single doc error logs and continues (mirrors the validator).
 */
export async function revalidateDealDocuments(
  dealId: string,
): Promise<RevalidationSummary> {
  const sb = supabaseAdmin();

  // Enumerate the deal's documents. ai_tax_year/doc_year are the tax-year
  // columns (NOT tax_year). Order by id for deterministic processing.
  let docs: RevalidationDocRow[] = [];
  try {
    const { data, error } = await (sb as any)
      .from("deal_documents")
      .select("id, canonical_type, ai_form_numbers, document_type, ai_tax_year, doc_year")
      .eq("deal_id", dealId)
      .order("id", { ascending: true });

    if (error) {
      console.warn(
        "[revalidateDealDocuments] deal_documents query failed (non-fatal):",
        error.message,
      );
    } else if (Array.isArray(data)) {
      docs = data as RevalidationDocRow[];
    }
  } catch (err) {
    console.warn(
      "[revalidateDealDocuments] deal_documents query threw (non-fatal):",
      err,
    );
  }

  const outcomes: RevalidationDocOutcome[] = [];

  for (const doc of docs) {
    const taxYear = resolveDocTaxYear(doc);
    // formType is informational for the summary; the validator resolves it
    // itself internally. A non-tax doc resolves to null and self-gates.
    const formType = resolveIrsFormType({
      canonical_type: doc.canonical_type,
      ai_form_numbers: doc.ai_form_numbers,
      document_type: doc.document_type,
    });

    let status = "SKIPPED";
    try {
      const result = await runPostExtractionValidation(
        doc.id,
        dealId,
        {
          canonical_type: doc.canonical_type,
          ai_form_numbers: doc.ai_form_numbers,
          document_type: doc.document_type,
        },
        taxYear,
      );
      status = result.status;
    } catch (err) {
      // The validator never throws by contract; guard defensively so one bad
      // doc cannot abort the whole deal revalidation.
      console.warn(
        `[revalidateDealDocuments] validation failed for doc ${doc.id} (non-fatal):`,
        err,
      );
      status = "SKIPPED";
    }

    outcomes.push({
      documentId: doc.id,
      formType,
      taxYear,
      status,
      // The validator persists a row for every tax-return doc (validation result
      // or audit SKIPPED) except under the deal-level validation_disabled escape
      // hatch; non-tax docs self-gate with no row.
      rowWritten: isTaxReturnDocument(doc),
    });
  }

  const summary = summarizeRevalidation(dealId, outcomes);

  // One ledger event with the full summary as meta.
  await writeEvent({
    dealId,
    kind: "extraction.deal_revalidation_complete",
    scope: "extraction",
    action: "deal_revalidation_complete",
    meta: summary as unknown as Record<string, unknown>,
  }).catch(() => {});

  return summary;
}
