import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { upsertDealFinancialFact } from "@/lib/financialFacts/writeFact";

export type MaterializeFromDocsResult =
  | { ok: true; factsWritten: number; docsConsidered: number }
  | { ok: false; error: string };

/**
 * Canonical types that represent financial documents.
 * These are values stamped on deal_documents.canonical_type
 * by the artifact processor via resolveDocTyping().
 */
const FINANCIAL_CANONICAL_TYPES = new Set([
  "INCOME_STATEMENT",
  "BALANCE_SHEET",
  "CASH_FLOW_STATEMENT",
  "RENT_ROLL",
  "PFS",
  "PERSONAL_FINANCIAL_STATEMENT",
  "BUSINESS_TAX_RETURN",
  "PERSONAL_TAX_RETURN",
  "TAX_RETURN",
  "T12",
  "BANK_STATEMENT",
]);

/**
 * Materialize minimal canonical facts from classified deal_documents.
 *
 * Writes one anchoring SOURCE_DOCUMENT fact per classified financial document.
 * This is sufficient to unblock snapshot recompute (getVisibleFacts.total > 0).
 *
 * Idempotent: uses upsertDealFinancialFact which deduplicates on the 9-column
 * natural key (deal_id, bank_id, source_document_id, fact_type, fact_key,
 * fact_period_start, fact_period_end, owner_type, owner_entity_id).
 */
export async function materializeFactsFromArtifacts(opts: {
  dealId: string;
  bankId: string;
}): Promise<MaterializeFromDocsResult> {
  try {
    const sb = supabaseAdmin();
    const { dealId, bankId } = opts;

    // Query deal_documents that have been classified with a financial canonical_type
    const { data: docs, error: docErr } = await (sb as any)
      .from("deal_documents")
      .select("id, canonical_type, ai_confidence, finalized_at")
      .eq("deal_id", dealId)
      .not("canonical_type", "is", null)
      .not("finalized_at", "is", null);

    if (docErr) return { ok: false, error: docErr.message };

    const allDocs = (docs ?? []) as Array<{
      id: string;
      canonical_type: string;
      ai_confidence: number | null;
      finalized_at: string;
    }>;

    // Filter to financial document types only
    const financialDocs = allDocs.filter((d) =>
      FINANCIAL_CANONICAL_TYPES.has(d.canonical_type),
    );

    if (financialDocs.length === 0) {
      return { ok: true, factsWritten: 0, docsConsidered: allDocs.length };
    }

    let factsWritten = 0;

    for (const doc of financialDocs) {
      const result = await upsertDealFinancialFact({
        dealId,
        bankId,
        sourceDocumentId: doc.id,
        factType: "SOURCE_DOCUMENT",
        factKey: doc.canonical_type,
        factValueNum: null,
        factValueText: doc.canonical_type,
        confidence: doc.ai_confidence ?? 0.5,
        provenance: {
          source_type: "DOC_EXTRACT",
          source_ref: `deal_documents:${doc.id}`,
          as_of_date: null,
          extractor: "materializeFactsFromArtifacts:v1",
        },
      });

      if (result.ok) factsWritten++;
    }

    return { ok: true, factsWritten, docsConsidered: allDocs.length };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
