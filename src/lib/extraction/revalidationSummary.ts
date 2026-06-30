/**
 * SPEC-VALIDATION-GATE-RESTORE-PROGRAM-1 Phase 2 — pure helpers for the
 * deal-level revalidation orchestrator.
 *
 * Kept free of `server-only`/Supabase so the tax-year resolver and the
 * aggregation reducer can be unit-tested directly (mirrors resolveIrsFormType.ts
 * and Phase 1's canonicalFactKeys.ts). The orchestrator re-exports these.
 *
 * Pure functions. No DB, no side effects.
 */

/** Shape selected from deal_documents for revalidation. */
export type RevalidationDocRow = {
  id: string;
  canonical_type: string | null;
  ai_form_numbers: string[] | null;
  document_type: string | null;
  ai_tax_year: number | null;
  doc_year: number | null;
};

/** Per-document line in the summary surfaced to callers. */
export type PerDocRevalidation = {
  documentId: string;
  formType: string | null;
  taxYear: number | null;
  status: string; // ValidationStatus | "SKIPPED"
};

/**
 * Internal reducer input — per-doc outcome plus whether the validator wrote a
 * persisted row (tax-return docs always get a row except under the deal-level
 * validation_disabled escape hatch; non-tax docs self-gate with no row).
 */
export type RevalidationDocOutcome = PerDocRevalidation & {
  rowWritten: boolean;
};

/** Aggregate result returned by revalidateDealDocuments. */
export type RevalidationSummary = {
  dealId: string;
  docsProcessed: number;
  rowsWritten: number;
  byStatus: Record<string, number>;
  passedTotal: number;
  failedTotal: number;
  skippedTotal: number;
  perDoc: PerDocRevalidation[];
};

/**
 * SPEC-VALIDATION-GATE-RESTORE-PROGRAM-1 Phase 2b — completion predicate.
 *
 * Deal-level revalidation should fire when the deal's extraction goes quiescent,
 * i.e. no queued/running runs remain. The finalizing run is already terminal at
 * check time, so it does not count itself; when the last in-flight run finalizes
 * the count reaches 0 and revalidation fires once.
 *
 * Strict === 0 is negative- and NaN-safe (both compare false).
 */
export function shouldTriggerDealRevalidation(inFlightCount: number): boolean {
  return inFlightCount === 0;
}

/**
 * Resolve a document's tax year for validation routing.
 * SPEC §Scope: ai_tax_year ?? doc_year (null-safe; the tax-year column on
 * deal_documents is ai_tax_year/doc_year, NOT tax_year).
 */
export function resolveDocTaxYear(doc: {
  ai_tax_year: number | null;
  doc_year: number | null;
}): number | null {
  return doc.ai_tax_year ?? doc.doc_year ?? null;
}

/**
 * Reduce per-doc validation outcomes into a RevalidationSummary.
 *
 * passedTotal/failedTotal/skippedTotal are coarse doc-level rollups:
 *   - passedTotal  = VERIFIED docs
 *   - failedTotal  = FLAGGED + BLOCKED docs (arithmetic failures)
 *   - skippedTotal = SKIPPED docs
 * PARTIAL (some checks pass, some skip, none fail) is captured in byStatus only.
 * byStatus is the authoritative exact-status breakdown.
 */
export function summarizeRevalidation(
  dealId: string,
  outcomes: RevalidationDocOutcome[],
): RevalidationSummary {
  const byStatus: Record<string, number> = {};
  let rowsWritten = 0;
  let passedTotal = 0;
  let failedTotal = 0;
  let skippedTotal = 0;
  const perDoc: PerDocRevalidation[] = [];

  for (const o of outcomes) {
    byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
    if (o.rowWritten) rowsWritten += 1;

    if (o.status === "VERIFIED") passedTotal += 1;
    else if (o.status === "FLAGGED" || o.status === "BLOCKED") failedTotal += 1;
    else if (o.status === "SKIPPED") skippedTotal += 1;
    // PARTIAL intentionally falls through — counted in byStatus only.

    perDoc.push({
      documentId: o.documentId,
      formType: o.formType,
      taxYear: o.taxYear,
      status: o.status,
    });
  }

  return {
    dealId,
    docsProcessed: outcomes.length,
    rowsWritten,
    byStatus,
    passedTotal,
    failedTotal,
    skippedTotal,
    perDoc,
  };
}
