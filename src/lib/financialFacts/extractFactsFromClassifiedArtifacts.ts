import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { extractFactsFromDocument } from "@/lib/financialSpreads/extractFactsFromDocument";
import { backfillCanonicalFactsFromSpreads } from "@/lib/financialFacts/backfillFromSpreads";

/**
 * Financial artifact doc types that the AI extractors can handle.
 * Maps to document_artifacts.doc_type values.
 */
const EXTRACTABLE_DOC_TYPES = new Set([
  "INCOME_STATEMENT",
  "FINANCIAL_STATEMENT",
  "T12",
  "TRAILING_12",
  "BALANCE_SHEET",
  "RENT_ROLL",
  "IRS_1040",
  "IRS_1120",
  "IRS_1120S",
  "IRS_1065",
  "IRS_BUSINESS",
  "IRS_PERSONAL",
  "K1",
  "PERSONAL_TAX_RETURN",
  "BUSINESS_TAX_RETURN",
  "TAX_RETURN",
  "PFS",
  "PERSONAL_FINANCIAL_STATEMENT",
  "SBA_413",
  "TERM_SHEET",
  "LOI",
  "CLOSING_STATEMENT",
  "APPRAISAL",
  "COLLATERAL_SCHEDULE",
  "OPERATING_STATEMENT",
]);

export type ExtractFromArtifactsResult =
  | { ok: true; extracted: number; skipped: number; failed: number; backfillFactsWritten: number }
  | { ok: false; error: string };

/**
 * Extract and materialize financial facts from classified document artifacts.
 *
 * For each classified financial artifact that hasn't been extracted yet,
 * runs the AI-powered extractors to create real financial facts.
 * Then runs spread-based canonical fact backfill.
 *
 * This bridges the gap when artifacts are classified but the spread pipeline
 * hasn't processed them yet.
 */
export async function extractFactsFromClassifiedArtifacts(opts: {
  dealId: string;
  bankId: string;
}): Promise<ExtractFromArtifactsResult> {
  try {
    const sb = supabaseAdmin();
    const { dealId, bankId } = opts;

    // 1) Find classified financial artifacts sourced from deal_documents
    const { data: artifacts, error: artErr } = await (sb as any)
      .from("document_artifacts")
      .select("id, source_id, doc_type")
      .eq("deal_id", dealId)
      .eq("source_table", "deal_documents")
      .not("doc_type", "is", null)
      .in("status", ["classified", "extracted", "matched"]);

    if (artErr) return { ok: false, error: artErr.message };

    const allArtifacts = (artifacts ?? []) as Array<{
      id: string;
      source_id: string;
      doc_type: string;
    }>;

    // Filter to extractable financial doc types
    const financialArtifacts = allArtifacts.filter((a) =>
      EXTRACTABLE_DOC_TYPES.has(a.doc_type.toUpperCase()),
    );

    if (financialArtifacts.length === 0) {
      // No classified financial artifacts — try canonical backfill only
      const backfill = await backfillCanonicalFactsFromSpreads({ dealId, bankId });
      return {
        ok: true,
        extracted: 0,
        skipped: 0,
        failed: 0,
        backfillFactsWritten: backfill.ok ? backfill.factsWritten : 0,
      };
    }

    // 2) Check which source documents already have real extracted facts
    //    (NOT heartbeats — heartbeat-only docs must be re-extracted)
    const sourceDocIds = financialArtifacts.map((a) => a.source_id);
    const { data: existingRealFacts } = await (sb as any)
      .from("deal_financial_facts")
      .select("source_document_id")
      .eq("deal_id", dealId)
      .eq("bank_id", bankId)
      .neq("fact_type", "EXTRACTION_HEARTBEAT")
      .in("source_document_id", sourceDocIds);

    const alreadyExtracted = new Set(
      ((existingRealFacts ?? []) as Array<{ source_document_id: string }>)
        .map((r) => r.source_document_id),
    );

    const toExtract = financialArtifacts.filter((a) => !alreadyExtracted.has(a.source_id));
    const skipped = financialArtifacts.length - toExtract.length;

    if (toExtract.length === 0) {
      // All already extracted — just try canonical backfill
      const backfill = await backfillCanonicalFactsFromSpreads({ dealId, bankId });
      return {
        ok: true,
        extracted: 0,
        skipped,
        failed: 0,
        backfillFactsWritten: backfill.ok ? backfill.factsWritten : 0,
      };
    }

    // 3) Extract facts for unprocessed documents (limited concurrency)
    const MAX_DOCS = 12;
    const CONCURRENCY = 3;
    const batch = toExtract.slice(0, MAX_DOCS);
    let extracted = 0;
    let failed = 0;

    for (let i = 0; i < batch.length; i += CONCURRENCY) {
      const chunk = batch.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        chunk.map((artifact) =>
          extractFactsFromDocument({
            dealId,
            bankId,
            documentId: artifact.source_id,
            docTypeHint: artifact.doc_type,
          }),
        ),
      );

      for (const result of results) {
        if (result.status === "fulfilled" && result.value.ok) {
          extracted++;
        } else {
          failed++;
          const reason = result.status === "rejected"
            ? result.reason?.message
            : "extraction_failed";
          console.warn("[extractFactsFromClassifiedArtifacts] doc extraction failed:", reason);
        }
      }
    }

    console.info("[extractFactsFromClassifiedArtifacts]", {
      dealId,
      artifacts: financialArtifacts.length,
      extracted,
      skipped,
      failed,
    });

    // 4) Run canonical fact backfill from any existing spreads
    const backfill = await backfillCanonicalFactsFromSpreads({ dealId, bankId });

    return {
      ok: true,
      extracted,
      skipped,
      failed,
      backfillFactsWritten: backfill.ok ? backfill.factsWritten : 0,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
